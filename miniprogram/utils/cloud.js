const { getMessage } = require('./error-messages')

/**
 * 统一调用云函数，返回 { ok, data }
 * ok: false 时自动 toast 中文错误信息
 */
function call(name, data = {}) {
  return wx.cloud.callFunction({ name, data })
    .then(res => {
      const result = res.result || {}
      if (!result.ok) {
        wx.showToast({ title: getMessage(result.code), icon: 'none', duration: 2500 })
        return { ok: false, code: result.code }
      }
      return { ok: true, data: result.data }
    })
    .catch(e => {
      console.error('callFunction error', name, e)
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
      return { ok: false, code: 'NETWORK_ERROR' }
    })
}

module.exports = { call }
