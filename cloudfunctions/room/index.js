const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handlers = require('./handlers')
const { generate } = require('./lib/code-generator')

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, ...data } = event

  switch (action) {
    case 'create':
      return handlers.create(data, OPENID, cloud.database(), { generateCode: generate })
    case 'join':
      return handlers.join(data, OPENID, cloud.database())
    case 'score':
      return handlers.score(data, OPENID, cloud.database())
    case 'leave':
      return handlers.leave(data, OPENID, cloud.database())
    case 'close':
      return handlers.close(data, OPENID, cloud.database())
    default:
      return { ok: false, code: 'UNKNOWN_ACTION', message: `未知 action: ${action}` }
  }
}
