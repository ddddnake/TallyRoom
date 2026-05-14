const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { upsertProfile } = require('./handlers')

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, ...data } = event

  switch (action) {
    case 'upsertProfile':
      return upsertProfile(data, OPENID, cloud.database())
    default:
      return { ok: false, code: 'UNKNOWN_ACTION', message: `未知 action: ${action}` }
  }
}
