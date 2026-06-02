const { call } = require('../../utils/cloud')
const app = getApp()

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    submitting: false
  },

  async onShow() {
    // 已设置过 profile 的用户不应停留在引导页
    const profile = await app.getProfile()
    console.log('[setup.onShow] profile:', profile)
    if (profile) {
      // 但若 storage 里还有 pending 邀请/意图，说明刚保存完资料正准备跳房间，让 onSubmit 的跳转完成，别抢路由
      const pendingRoom = wx.getStorageSync('pending_share_room')
      const pendingCode = wx.getStorageSync('pending_share_code')
      const pendingIntent = wx.getStorageSync('pending_intent')
      if (pendingRoom || pendingCode || pendingIntent) {
        console.log('[setup.onShow] pending exists, skip switchTab')
        return
      }
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  onNickInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  async onSubmit() {
    console.log('[profile.onSubmit] START. avatarUrl:', this.data.avatarUrl, 'nickName:', this.data.nickName, 'submitting:', this.data.submitting)
    if (this.data.submitting) return
    const nickName = (this.data.nickName || '').trim()
    if (!this.data.avatarUrl || !nickName) {
      console.log('[profile.onSubmit] BAILOUT: missing avatar or nickname')
      return
    }

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

      const callRes = await call('user', {
        action: 'upsertProfile',
        nickName,
        avatarUrl: finalUrl
      })
      console.log('[profile.onSubmit] upsertProfile result:', callRes)
      const { ok, data } = callRes

      if (ok) {
        // 把刚保存的 profile 写入内存缓存，避免下一页 onShow 再去数据库读时遇到一致性延迟
        // 必须带上 _openid，否则 detail.onShow 拿 myOpenid 会失败
        app.setProfileCache({
          _id: data && data.openid,
          _openid: data && data.openid,
          nickName,
          avatarUrl: finalUrl
        })

        // 1. 来自分享卡/扫码的 pending 邀请，优先处理
        const pendingRoom = wx.getStorageSync('pending_share_room')
        const pendingCode = wx.getStorageSync('pending_share_code')
        if (pendingRoom || pendingCode) {
          wx.removeStorageSync('pending_share_room')
          wx.removeStorageSync('pending_share_code')
          const target = pendingRoom
            ? '/pages/room/detail?id=' + pendingRoom + '&fromShare=1'
            : '/pages/room/detail?code=' + pendingCode + '&fromShare=1'
          wx.redirectTo({
            url: target,
            fail: () => wx.switchTab({ url: '/pages/index/index' })
          })
          return
        }

        // 2. 来自首页主动操作（创建/加入）的 pending 意图：留给首页 onShow 消费
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
