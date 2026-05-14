const { formatTime } = require('../../utils/format')

Page({
  data: {
    rooms: [],
    loading: true
  },

  async onShow() {
    const db = wx.cloud.database()
    const me = await db.collection('room_members')
      .where({ _openid: '{openid}' })
      .orderBy('joinedAt', 'desc')
      .get()

    if (!me.data.length) {
      this.setData({ loading: false })
      return
    }

    const roomIds = [...new Set(me.data.map(m => m.roomId))]
    const _ = db.command
    const roomData = await db.collection('rooms')
      .where({ _id: _.in(roomIds) })
      .get()

    const rooms = roomData.data.map(r => ({
      ...r,
      dateText: r.createdAt ? formatTime(new Date(r.createdAt)) : ''
    }))

    this.setData({ rooms, loading: false })
  },

  onTapRoom(e) {
    const { id, state } = e.currentTarget.dataset
    const readOnly = state === 2 ? '1' : '0'
    wx.navigateTo({ url: '/pages/room/detail?id=' + id + '&readOnly=' + readOnly })
  }
})
