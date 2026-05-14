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
      wx.redirectTo({ url: '/pages/index/index' })
    }
  }
})
