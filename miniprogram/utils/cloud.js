const { getMessage } = require('./error-messages')

/**
 * 统一调用云函数，返回 { ok, data, code }
 * ok: false 时自动 toast 错误信息（优先用云端 message，没有则查中文表）
 * 调用方传 silent:true 则不自动 toast，由调用方处理
 */
function call(name, data = {}, opts = {}) {
  return wx.cloud.callFunction({ name, data })
    .then(res => {
      const result = res.result || {}
      if (!result.ok) {
        if (!opts.silent) {
          const msg = result.message || getMessage(result.code)
          wx.showToast({ title: msg, icon: 'none', duration: 2500 })
        }
        return { ok: false, code: result.code, message: result.message, data: result.data }
      }
      return { ok: true, data: result.data }
    })
    .catch(e => {
      console.error('callFunction error', name, e)
      if (!opts.silent) wx.showToast({ title: '网络异常，请重试', icon: 'none' })
      return { ok: false, code: 'NETWORK_ERROR' }
    })
}

module.exports = { call }
