App({
  onLaunch() {
    wx.cloud.init({ env: 'text-d4gfwdk35bb30d29b' })
    this._profile = null
    this._profilePromise = null
  },

  /** 获取当前 openid 对应的 profile，无则返回 null */
  getProfile() {
    if (this._profile) return Promise.resolve(this._profile)
    if (this._profilePromise) return this._profilePromise

    this._profilePromise = wx.cloud.database()
      .collection('profiles')
      .limit(1)
      .get()
      .then(res => {
        console.log('[getProfile] result:', res)
        this._profilePromise = null
        const profile = res.data && res.data.length ? res.data[0] : null
        if (profile) this._profile = profile
        return profile
      })
      .catch(e => {
        console.error('[getProfile] failed:', e)
        this._profilePromise = null
        return null
      })

    return this._profilePromise
  },

  clearProfileCache() {
    this._profile = null
    this._profilePromise = null
  },

  /** 把刚刚保存的 profile 直接写入缓存，避免下一页 onShow 时遇到云数据库读写一致性延迟 */
  setProfileCache(profile) {
    this._profile = profile
    this._profilePromise = null
  }
})
