const { formatTime } = require('../../utils/format')
const app = getApp()

Page({
  data: {
    rooms: [],
    loading: true
  },

  async onShow() {
    const profile = await app.getProfile()
    if (!profile) {
      wx.redirectTo({ url: '/pages/setup/profile' })
      return
    }
    const myOpenid = profile._openid || profile._id

    const db = wx.cloud.database()
    const me = await db.collection('room_members')
      .where({ userOpenid: myOpenid })
      .orderBy('joinedAt', 'desc')
      .get()

    if (!me.data.length) {
      this.setData({ rooms: [], loading: false })
      return
    }

    const roomIds = [...new Set(me.data.map(m => m.roomId))]
    const _ = db.command
    const roomData = await db.collection('rooms')
      .where({ _id: _.in(roomIds) })
      .get()

    // 按 createdAt 倒序：最新建的房间在前
    const rooms = (roomData.data || [])
      .map(r => ({
        ...r,
        dateText: r.createdAt ? formatTime(new Date(r.createdAt)) : ''
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

    this.setData({ rooms, loading: false })
  },

  onTapRoom(e) {
    const { id, state } = e.currentTarget.dataset
    const readOnly = state === 2 ? '1' : '0'
    wx.navigateTo({ url: '/pages/room/detail?id=' + id + '&readOnly=' + readOnly })
  }
})
