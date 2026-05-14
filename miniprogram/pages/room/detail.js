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
      // 是否需要尝试加入：来自分享（带 code）或外部跳转（带 fromShare）
      needsJoin: !!(options.code || options.fromShare)
    })
  },

  async onShow() {
    // 拿当前用户 profile（顺便取 openid）
    const profile = await app.getProfile()
    console.log('[room.onShow] profile:', profile, 'needsJoin:', this.data.needsJoin)
    if (!profile) {
      // 没设置过头像昵称：暂存当前房间，跳引导页
      if (this.data.needsJoin) {
        wx.setStorageSync('pending_share_room', this.data.id)
      }
      wx.redirectTo({ url: '/pages/setup/profile' })
      return
    }
    const myOpenid = profile._openid || profile._id
    if (myOpenid) this.setData({ myOpenid })

    // 检查当前用户是否已是房间成员；不是则尝试加入
    if (!this._joined && !this.data.readOnly) {
      const db = wx.cloud.database()
      const memRes = await db.collection('room_members')
        .where({ roomId: this.data.id, userOpenid: myOpenid, state: 1 })
        .limit(1).get()

      console.log('[room.onShow] my membership check:', memRes.data.length, 'records for', myOpenid)

      if (!memRes.data.length) {
        // 不是成员 → 查房间 code 然后 join
        const roomRes = await db.collection('rooms').doc(this.data.id).get().catch(e => {
          console.error('[room.onShow] get room failed:', e)
          return null
        })
        const room = roomRes && (Array.isArray(roomRes.data) ? roomRes.data[0] : roomRes.data)
        console.log('[room.onShow] fetched room:', room)
        if (!room) {
          wx.showToast({ title: '房间不存在', icon: 'none' })
          wx.switchTab({ url: '/pages/index/index' })
          return
        }
        if (room.state === 2) {
          this.setData({ readOnly: true })
        } else {
          console.log('[room.onShow] auto-joining with code:', room.code)
          const { ok, data, code: errCode } = await call('room', { action: 'join', code: room.code })
          console.log('[room.onShow] join result:', { ok, data, errCode })
          if (!ok) {
            wx.switchTab({ url: '/pages/index/index' })
            return
          }
          if (data && data.roomId && data.roomId !== this.data.id) {
            this.setData({ id: data.roomId })
          }
        }
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
