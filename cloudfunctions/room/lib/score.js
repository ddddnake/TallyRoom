// 计算每人最终净分（含茶水均摊）。与小程序 miniprogram/utils/aggregate.js 同算法。
// 茶水均摊整数化：基础份额 + 余数稳定分给前 r 个成员（按 openid 字典序），保证总和精确等于 teaTotal
function computeUserScores(orders, members) {
  const rawScores = {}
  const teaPaid = {}
  members.forEach(m => {
    rawScores[m.userOpenid] = 0
    teaPaid[m.userOpenid] = 0
  })
  let teaTotal = 0
  orders.forEach(o => {
    const amt = Number(o.amount) || 0
    if (!o.toOpenid || o.toOpenid === '') {
      teaTotal += amt
      teaPaid[o.fromOpenid] = (teaPaid[o.fromOpenid] || 0) + amt
    } else {
      rawScores[o.fromOpenid] = (rawScores[o.fromOpenid] || 0) - amt
      rawScores[o.toOpenid] = (rawScores[o.toOpenid] || 0) + amt
    }
  })

  const n = members.length
  const baseShare = n > 0 ? Math.floor(teaTotal / n) : 0
  const remainder = teaTotal - baseShare * n
  const sortedOpenids = members.map(m => m.userOpenid).slice().sort()
  const extraShare = {}
  for (let i = 0; i < remainder; i++) extraShare[sortedOpenids[i]] = 1

  const userScores = {}
  members.forEach(m => {
    const raw = rawScores[m.userOpenid] || 0
    const paid = teaPaid[m.userOpenid] || 0
    const myShare = baseShare + (extraShare[m.userOpenid] || 0)
    userScores[m.userOpenid] = raw + paid - myShare
  })
  return userScores
}

module.exports = { computeUserScores }
