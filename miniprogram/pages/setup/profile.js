const { call } = require('../../utils/cloud')
const app = getApp()

Page({
  data: {
    avatarUrl: '',
    nickName: ''
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  onNickInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  async onSubmit() {
    const { ok } = await call('user', {
      action: 'upsertProfile',
      nickName: this.data.nickName,
      avatarUrl: this.data.avatarUrl
    })
    if (ok) {
      app.clearProfileCache()

      // 检查是否有待加入的分享房间
      const pendingCode = wx.getStorageSync('pending_share_code')
      const pendingRoom = wx.getStorageSync('pending_share_room')
      if (pendingCode && pendingRoom) {
        wx.removeStorageSync('pending_share_code')
        wx.removeStorageSync('pending_share_room')
        wx.redirectTo({ url: '/pages/room/detail?id=' + pendingRoom + '&code=' + pendingCode })
        return
      }

      wx.switchTab({ url: '/pages/index/index' })
    }
  }
})
