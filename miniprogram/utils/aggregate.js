/**
 * 按 room_orders + room_members 计算每人最终净分（含茶水均摊）、茶水合计、消息流、结算 summary
 * @param {Array} orders - room_orders 数组
 * @param {Array} members - room_members 数组（含已退出成员）
 * @returns {{ userScores, teaTotal, teaShare, teaShareDisplay, memberCount, summary, messages }}
 *   userScores: 每人最终净分（含茶水均摊），可直接用于头像下方展示和结算
 *   summary: 每人详细信息 [{openid, nickName, raw, teaPaid, teaShare, final}]
 */
function compute(orders, members) {
  const rawScores = {}     // 不含茶水的牌局净分
  const teaPaid = {}       // 每人已垫付的茶水
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

  // 茶水均摊整数化：基础份额 + 余数稳定分给前 r 个成员（按 openid 字典序），保证总和精确等于 teaTotal
  const n = members.length
  const baseShare = n > 0 ? Math.floor(teaTotal / n) : 0
  const remainder = teaTotal - baseShare * n
  const sortedOpenids = members.map(m => m.userOpenid).slice().sort()
  const extraShare = {}
  for (let i = 0; i < remainder; i++) extraShare[sortedOpenids[i]] = 1

  const userScores = {}
  const summary = []
  members.forEach(m => {
    const raw = rawScores[m.userOpenid] || 0
    const paid = teaPaid[m.userOpenid] || 0
    const myShare = baseShare + (extraShare[m.userOpenid] || 0)
    const final = raw + paid - myShare
    userScores[m.userOpenid] = final
    summary.push({
      openid: m.userOpenid,
      nickName: m.nickName,
      avatarUrl: m.avatarUrl,
      raw,
      teaPaid: paid,
      teaShare: myShare,
      final
    })
  })

  // 生成消息流文案
  const memberMap = {}
  members.forEach(m => { memberMap[m.userOpenid] = m.nickName })

  const messages = orders.map(o => {
    const fromName = o.fromNickSnap || memberMap[o.fromOpenid] || o.fromOpenid
    const amount = o.amount
    const isTea = !o.toOpenid || o.toOpenid === ''
    let parts
    if (isTea) {
      parts = [
        { type: 'name', text: fromName },
        { type: 'txt', text: ' 付茶水 ' },
        { type: 'amount', text: amount },
        { type: 'txt', text: ' 分' }
      ]
    } else {
      const toName = o.toNickSnap || memberMap[o.toOpenid] || o.toOpenid
      parts = [
        { type: 'name', text: fromName },
        { type: 'arrow', text: ' → ' },
        { type: 'name', text: toName },
        { type: 'txt', text: ' ' },
        { type: 'amount', text: amount },
        { type: 'txt', text: ' 分' }
      ]
    }
    return {
      text: parts.map(p => p.text).join(''),
      parts,
      time: o.createdAt,
      id: o._id,
      pending: !!o._pending
    }
  })

  const teaShareAvg = n > 0 ? teaTotal / n : 0
  return {
    userScores,
    teaTotal,
    teaShare: teaShareAvg,
    teaShareDisplay: teaShareAvg % 1 === 0 ? String(teaShareAvg) : teaShareAvg.toFixed(2),
    memberCount: n,
    summary,
    messages
  }
}

module.exports = { compute }
