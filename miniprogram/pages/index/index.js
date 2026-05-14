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
    const hours = new Date().getHours()
    const g = hours < 11 ? '早上好' : hours < 14 ? '中午好' : hours < 18 ? '下午好' : '晚上好'
    this.setData({ greeting: g + '，' + profile.nickName })

    // 检查是否在某进行中房间
    const db = wx.cloud.database()
    const myRooms = await db.collection('room_members')
      .where({ _openid: '{openid}', state: 1 }).get()
    if (myRooms.data.length) {
      const roomRes = await db.collection('rooms')
        .where({ _id: myRooms.data[0].roomId, state: 1 }).get()
      if (roomRes.data.length) {
        this.setData({ statsSummary: '你有一个进行中的房间' })
      }
    }
    // 加载本月简要统计
    await this._loadStats()
  },

  async _loadStats() {
    const db = wx.cloud.database()
    const _ = db.command
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

    try {
      const res = await db.collection('room_orders').where({
        createdAt: _.gte(monthStart)
      }).get()

      let netScore = 0
      const myOpenid = '{openid}'
      ;(res.data || []).forEach(o => {
        if (o.toOpenid === myOpenid) netScore += (o.amount || 0)
        if (o.fromOpenid === myOpenid) netScore -= (o.amount || 0)
      })

      this.setData({
        stats: {
          totalGames: 0,
          netScore
        }
      })
    } catch (e) {
      console.error('stats load error', e)
    }
  },

  async onCreateRoom() {
    const { ok, data } = await call('room', { action: 'create' })
    if (ok) {
      wx.navigateTo({ url: '/pages/room/detail?id=' + data.roomId })
    }
  },

  onShowJoin() { this.setData({ showJoin: true, code: '' }) },
  onCloseJoin() { this.setData({ showJoin: false }) },

  onCodeInput(e) {
    this.setData({ code: e.detail.value.toUpperCase() })
  },

  async onScanJoin() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: async (res) => {
        const scanned = (res.result || '').trim()
        // 扫小程序码：res.path 形如 "pages/room/detail?scene=AB3X9K"
        // 扫普通码：res.result 可能是邀请码本身
        let code = ''
        if (res.path) {
          const m = res.path.match(/scene=([A-Z0-9]+)/i)
          if (m) code = decodeURIComponent(m[1]).toUpperCase()
        }
        if (!code && /^[A-Z0-9]{6}$/i.test(scanned)) {
          code = scanned.toUpperCase()
        }
        if (!code) {
          wx.showToast({ title: '不是有效的房间码', icon: 'none' })
          return
        }
        this.setData({ code })
        await this._doJoin(code)
      },
      fail: () => { /* 用户取消，无需提示 */ }
    })
  },

  async onJoin() {
    await this._doJoin(this.data.code)
  },

  async _doJoin(code) {
    const { ok, data } = await call('room', { action: 'join', code })
    if (ok) {
      this.setData({ showJoin: false })
      wx.navigateTo({ url: '/pages/room/detail?id=' + data.roomId })
    }
  }
})
