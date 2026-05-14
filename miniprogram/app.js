App({
  onLaunch() {
    wx.cloud.init({ env: 'TALLY_ENV' })
    this._profilePromise = null
  },

  /** 获取当前 openid 对应的 profile，无则返回 null，供首页判断是否需要引导 */
  getProfile() {
    if (this._profilePromise) return this._profilePromise

    this._profilePromise = wx.cloud.database()
      .collection('profiles')
      .limit(1)
      .get()
      .then(res => {
        this._profilePromise = null
        return res.data && res.data.length ? res.data[0] : null
      })
      .catch(e => {
        this._profilePromise = null
        console.error('getProfile failed', e)
        return null
      })

    return this._profilePromise
  },

  /** 让首页强制重新获取 profile（设置完昵称头像后调用） */
  clearProfileCache() {
    this._profilePromise = null
  }
})
