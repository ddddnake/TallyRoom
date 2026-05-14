/**
 * 按 room_orders + room_members 计算每人净分、茶水合计、消息流
 * @param {Array} orders - room_orders 数组
 * @param {Array} members - room_members 数组 (state=1)
 * @returns {{ userScores: {}, teaTotal: number, messages: Array }}
 */
function compute(orders, members) {
  const userScores = {}
  let teaTotal = 0

  // 初始化所有在场成员分数为 0
  members.forEach(m => { userScores[m.userOpenid] = 0 })

  orders.forEach(o => {
    const amt = Number(o.amount) || 0
    if (!o.toOpenid || o.toOpenid === '') {
      // 茶水：付出方减，入茶水池
      teaTotal += amt
      userScores[o.fromOpenid] = (userScores[o.fromOpenid] || 0) - amt
    } else {
      // 转账：付方减，收方加
      userScores[o.fromOpenid] = (userScores[o.fromOpenid] || 0) - amt
      userScores[o.toOpenid] = (userScores[o.toOpenid] || 0) + amt
    }
  })

  // 生成消息流文案
  const memberMap = {}
  members.forEach(m => { memberMap[m.userOpenid] = m.nickName })

  const messages = orders.map(o => {
    const fromName = o.fromNickSnap || memberMap[o.fromOpenid] || o.fromOpenid
    const amount = o.amount
    const isTea = !o.toOpenid || o.toOpenid === ''
    // 拆分成片段，便于在 wxml 里给金额单独着色
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
      text: parts.map(p => p.text).join(''),  // 兼容旧用法
      parts,
      time: o.createdAt,
      id: o._id
    }
  })

  return { userScores, teaTotal, messages }
}

module.exports = { compute }
