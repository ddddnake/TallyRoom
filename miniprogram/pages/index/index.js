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
    const hours = new Date().getHours()
    const g = hours < 11 ? '早上好' : hours < 14 ? '中午好' : hours < 18 ? '下午好' : '晚上好'

    // 匿名也能浏览首页：未设置 profile 时显示通用欢迎语，主功能仍可见
    const profile = await app.getProfile()
    if (!profile) {
      this.setData({
        greeting: g + '，欢迎',
        statsSummary: '一起打牌，轻松记账',
        stats: null
      })
      return
    }
    this._myOpenid = profile._openid || profile._id
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

    // 授权完成后回到首页，自动续上之前的意图（创建/加入）
    const pendingIntent = wx.getStorageSync('pending_intent')
    if (pendingIntent) {
      wx.removeStorageSync('pending_intent')
      if (pendingIntent.action === 'create') this.onCreateRoom()
      else if (pendingIntent.action === 'join') this.onShowJoin()
    }
  },

  // 主动操作前确保已设置 profile；未设置则跳引导页（保留意图）
  async _ensureProfile(intent) {
    const profile = await app.getProfile()
    if (profile) return profile
    if (intent) wx.setStorageSync('pending_intent', intent)
    wx.navigateTo({ url: '/pages/setup/profile' })
    return null
  },

  async _loadStats() {
    const myOpenid = this._myOpenid
    if (!myOpenid) return
    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    ).getTime()

    // 复用 room.history：里面的 myScore 已含茶水均摊，跟历史页/房间内一致
    const { ok, data } = await call('room', { action: 'history' }, { silent: true })
    if (!ok || !data) return

    const monthRooms = (data.rooms || []).filter(r => (r.createdAt || 0) >= monthStart)
    const totalGames = monthRooms.length
    const netScore = monthRooms.reduce((sum, r) => sum + (r.myScore || 0), 0)
    this.setData({ stats: { totalGames, netScore } })
  },

  async onCreateRoom() {
    // 未授权：跳引导页，回来后自动恢复"创建"意图
    const profile = await this._ensureProfile({ action: 'create' })
    if (!profile) return

    // 先让用户填局名（可留空走默认）
    const defaultName = (profile.nickName ? profile.nickName : '') + '的房间'
    const input = await new Promise(resolve => {
      wx.showModal({
        title: '创建房间',
        editable: true,
        placeholderText: defaultName,
        content: '',
        confirmText: '创建',
        cancelText: '取消',
        success: (r) => resolve(r),
        fail: () => resolve({ cancel: true })
      })
    })
    if (!input.confirm) return

    const roomName = (input.content || '').trim() || defaultName

    const res = await call('room', { action: 'create', name: roomName }, { silent: true })
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

  async onShowJoin() {
    if (!(await this._ensureProfile({ action: 'join' }))) return
    this.setData({ showJoin: true, code: '' })
  },
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
