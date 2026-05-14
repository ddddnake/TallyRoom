const { call } = require('../../utils/cloud')
const { compute } = require('../../utils/aggregate')
const { formatTime } = require('../../utils/format')
const app = getApp()

Page({
  data: {
    id: '',
    readOnly: false,
    myOpenid: '',
    info: {},
    visibleMembers: [],
    orders: [],
    aggregated: {},
    teaTotal: 0,
    messages: [],
    showScorePopup: false,
    scoreForm: {},
    lastMsgId: ''
  },

  onLoad(options) {
    this.setData({
      id: options.id,
      readOnly: options.readOnly === '1',
      shareCode: options.code || ''
    })
  },

  async onShow() {
    // 通过分享链接进入：先确保已设置头像昵称
    if (this.data.shareCode) {
      const profile = await app.getProfile()
      if (!profile) {
        // 暂存分享 code，引导页完成后由首页跳转
        wx.setStorageSync('pending_share_code', this.data.shareCode)
        wx.setStorageSync('pending_share_room', this.data.id)
        wx.redirectTo({ url: '/pages/setup/profile' })
        return
      }
      if (profile._openid) this.setData({ myOpenid: profile._openid })
    } else {
      // 普通进入也要拿 openid 用于 wxml 渲染
      const profile = await app.getProfile()
      if (profile && profile._openid) this.setData({ myOpenid: profile._openid })
    }

    // 通过分享链接进入：先确保已加入房间
    if (this.data.shareCode && !this._joined) {
      console.log('[room] joining via share code:', this.data.shareCode, 'roomId:', this.data.id)
      const { ok, data, code } = await call('room', { action: 'join', code: this.data.shareCode })
      console.log('[room] join result:', { ok, data, code })
      if (!ok) {
        wx.switchTab({ url: '/pages/index/index' })
        return
      }
      // 如果服务端返回的 roomId 与 url 中的不一致，以服务端为准
      if (data && data.roomId && data.roomId !== this.data.id) {
        this.setData({ id: data.roomId })
      }
      this._joined = true
    }
    this._startWatchers()
  },

  onHide() {
    this._stopWatchers()
  },

  onUnload() {
    this._stopWatchers()
  },

  _startWatchers() {
    const db = wx.cloud.database()
    this._watchers = [
      db.collection('rooms').doc(this.data.id).watch({
        onChange: (snapshot) => {
          if (snapshot.docs && snapshot.docs.length) {
            this.setData({ info: snapshot.docs[0] })
          }
        },
        onError: (e) => console.error('rooms watch error', e)
      }),
      db.collection('room_members').where({ roomId: this.data.id }).watch({
        onChange: (snapshot) => {
          const members = snapshot.docs || []
          this.setData({ visibleMembers: members.filter(m => m.state === 1) })
          this._recalc()
        },
        onError: (e) => console.error('members watch error', e)
      }),
      db.collection('room_orders').where({ roomId: this.data.id }).orderBy('createdAt', 'asc').watch({
        onChange: (snapshot) => {
          const orders = snapshot.docs || []
          this.setData({ orders, lastMsgId: orders.length ? 'msg-' + orders[orders.length - 1]._id : '' })
          this._recalc()
        },
        onError: (e) => console.error('orders watch error', e)
      })
    ]
  },

  _stopWatchers() {
    if (this._watchers) {
      this._watchers.forEach(w => w.close())
      this._watchers = null
    }
  },

  _recalc() {
    const { visibleMembers, orders } = this.data
    if (!visibleMembers.length) return
    const result = compute(orders, visibleMembers)
    const messages = result.messages.map(m => ({
      ...m,
      timeText: formatTime(new Date(m.time))
    }))
    this.setData({
      aggregated: result.userScores,
      teaTotal: result.teaTotal,
      messages
    })
  },

  onShowScore() {
    this.setData({ showScorePopup: true, scoreForm: {} })
  },

  onCloseScore() {
    this.setData({ showScorePopup: false })
  },

  onScoreInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['scoreForm.' + key]: e.detail.value })
  },

  async onSubmitScore() {
    const form = this.data.scoreForm
    const entries = this.data.visibleMembers
      .filter(m => m.userOpenid !== this.data.myOpenid && form[m.userOpenid])
      .map(m => ({ toOpenid: m.userOpenid, amount: parseInt(form[m.userOpenid], 10) }))

    if (form._tea && parseInt(form._tea, 10) > 0) {
      entries.push({ toOpenid: '', amount: parseInt(form._tea, 10) })
    }

    if (!entries.length) {
      wx.showToast({ title: '请至少填写一项', icon: 'none' })
      return
    }

    const { ok } = await call('room', {
      action: 'score',
      roomId: this.data.id,
      entries
    })

    if (ok) {
      this.setData({ showScorePopup: false })
    }
  },

  async onLeave() {
    const res = await new Promise(r => {
      wx.showModal({
        title: '退出房间',
        content: '退出后你可以重新加入',
        success: r
      })
    })
    if (!res.confirm) return

    const { ok } = await call('room', { action: 'leave', roomId: this.data.id })
    if (ok) {
      wx.navigateBack()
    }
  },

  async onCloseRoom() {
    const res = await new Promise(r => {
      wx.showModal({
        title: '关闭房间',
        content: '关闭后所有人无法继续计分，确定吗？',
        success: r
      })
    })
    if (!res.confirm) return

    const { ok } = await call('room', { action: 'close', roomId: this.data.id })
    if (ok) {
      wx.showToast({ title: '房间已关闭', icon: 'none' })
    }
  },

  onShareAppMessage() {
    const code = (this.data.info && this.data.info.code) || ''
    return {
      title: '邀请你加入打牌记账房间',
      path: '/pages/room/detail?id=' + this.data.id + (code ? '&code=' + code : '')
    }
  }
})
