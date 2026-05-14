const { call } = require('../../utils/cloud')
const app = getApp()

Page({
  data: {
    greeting: '',
    statsSummary: '一起打牌，轻松记账',
    stats: null,
    showJoin: false,
    code: ''
  },

  async onShow() {
    // 检查 profile
    const profile = await app.getProfile()
    if (!profile) {
      wx.redirectTo({ url: '/pages/setup/profile' })
      return
    }
    this._myOpenid = profile._openid || profile._id
    const hours = new Date().getHours()
    const g = hours < 11 ? '早上好' : hours < 14 ? '中午好' : hours < 18 ? '下午好' : '晚上好'
    this.setData({ greeting: g + '，' + profile.nickName })

    // 先 sweep 一遍：把超时的进行中房间自动关闭（静默）
    await call('room', { action: 'sweep' }, { silent: true })

    // 检查是否在某进行中房间
    const db = wx.cloud.database()
    const myRooms = await db.collection('room_members')
      .where({ userOpenid: this._myOpenid, state: 1 }).get()
    if (myRooms.data.length) {
      const roomRes = await db.collection('rooms')
        .where({ _id: myRooms.data[0].roomId, state: 1 }).get()
      if (roomRes.data.length) {
        this.setData({ statsSummary: '你有一个进行中的房间' })
      } else {
        this.setData({ statsSummary: '一起打牌，轻松记账' })
      }
    } else {
      this.setData({ statsSummary: '一起打牌，轻松记账' })
    }

    // 加载本月简要统计
    await this._loadStats()
  },

  async _loadStats() {
    const db = wx.cloud.database()
    const _ = db.command
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const myOpenid = this._myOpenid
    if (!myOpenid) return

    try {
      // 本月我参与过的房间数（按 room_members joinedAt 算）
      const myMemRes = await db.collection('room_members').where({
        userOpenid: myOpenid,
        joinedAt: _.gte(monthStart)
      }).get()
      const totalGames = (myMemRes.data || []).length

      // 本月我相关的订单（我作为付方或收方）→ 算净分
      // 用 or 语义：我付的 + 我收的
      const ordersRes = await db.collection('room_orders').where(
        _.and([
          { createdAt: _.gte(monthStart) },
          _.or([
            { fromOpenid: myOpenid },
            { toOpenid: myOpenid }
          ])
        ])
      ).get()

      let netScore = 0
      ;(ordersRes.data || []).forEach(o => {
        if (o.toOpenid === myOpenid) netScore += (o.amount || 0)
        if (o.fromOpenid === myOpenid) netScore -= (o.amount || 0)
      })

      this.setData({ stats: { totalGames, netScore } })
    } catch (e) {
      console.error('stats load error', e)
    }
  },

  async onCreateRoom() {
    const res = await call('room', { action: 'create' }, { silent: true })
    if (res.ok) {
      wx.navigateTo({ url: '/pages/room/detail?id=' + res.data.roomId })
      return
    }
    if (res.code === 'ALREADY_IN_ROOM' && res.data && res.data.roomId) {
      await this._promptResume(res.message, res.data.roomId)
      return
    }
    wx.showToast({ title: res.message || '创建失败', icon: 'none' })
  },

  onShowJoin() { this.setData({ showJoin: true, code: '' }) },
  onCloseJoin() { this.setData({ showJoin: false }) },

  onCodeInput(e) {
    this.setData({ code: e.detail.value.toUpperCase() })
  },

  async onJoin() {
    const res = await call('room', { action: 'join', code: this.data.code }, { silent: true })
    if (res.ok) {
      this.setData({ showJoin: false })
      wx.navigateTo({ url: '/pages/room/detail?id=' + res.data.roomId })
      return
    }
    if (res.code === 'ALREADY_IN_ROOM' && res.data && res.data.roomId) {
      this.setData({ showJoin: false })
      await this._promptResume(res.message, res.data.roomId)
      return
    }
    wx.showToast({ title: res.message || '加入失败', icon: 'none' })
  },

  _promptResume(message, roomId) {
    return new Promise(resolve => {
      wx.showModal({
        title: '提示',
        content: message || '你还在另一个进行中的房间',
        confirmText: '前往',
        cancelText: '我知道了',
        success(r) {
          if (r.confirm) {
            wx.navigateTo({ url: '/pages/room/detail?id=' + roomId })
          }
          resolve()
        }
      })
    })
  }
})
