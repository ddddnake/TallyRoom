const { call } = require('../../utils/cloud')
const app = getApp()

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    submitting: false
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  onNickInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  async onSubmit() {
    if (this.data.submitting) return
    if (!this.data.avatarUrl || !this.data.nickName) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '上传中...', mask: true })

    try {
      // 上传头像到云存储（仅当 avatarUrl 是本地临时路径时）
      let finalUrl = this.data.avatarUrl
      if (finalUrl.startsWith('wxfile://') || finalUrl.startsWith('http://tmp/') || finalUrl.startsWith('wx://')) {
        const ext = (finalUrl.match(/\.(\w+)(\?|$)/) || [])[1] || 'jpg'
        const cloudPath = 'avatars/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath,
          filePath: finalUrl
        })
        finalUrl = uploadRes.fileID
      }

      const { ok } = await call('user', {
        action: 'upsertProfile',
        nickName: this.data.nickName,
        avatarUrl: finalUrl
      })

      if (ok) {
        app.clearProfileCache()

        const pendingRoom = wx.getStorageSync('pending_share_room')
        if (pendingRoom) {
          wx.removeStorageSync('pending_share_code')
          wx.removeStorageSync('pending_share_room')
          wx.redirectTo({ url: '/pages/room/detail?id=' + pendingRoom + '&fromShare=1' })
          return
        }
        wx.switchTab({ url: '/pages/index/index' })
      }
    } catch (e) {
      console.error('upload avatar failed', e)
      wx.showToast({ title: '头像上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  }
})
