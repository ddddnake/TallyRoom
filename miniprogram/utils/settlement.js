/**
 * 最少笔数结算算法
 *
 * @param {Array<{openid, nickName, score}>} balances - 每人的净分数组
 *   score > 0 表示赢，score < 0 表示输，单位"分"
 * @returns {Array<{fromOpenid, fromName, toOpenid, toName, amount}>}
 *   按"输家 → 赢家"方向的转账清单（最少笔数）
 *
 * 算法：贪心配对最大正负值。这是 NP-Hard 的简化解，
 * 实际中得到的笔数在 n-1 以内，对小房间足够好。
 */
function settle(balances) {
  // 去 0、克隆，避免修改入参
  const pos = []  // 赢家
  const neg = []  // 输家
  balances.forEach(b => {
    const s = Math.round(b.score || 0)
    if (s > 0) pos.push({ ...b, score: s })
    else if (s < 0) neg.push({ ...b, score: s })
  })
  // 倒序：欠最多的先付给赢最多的
  pos.sort((a, b) => b.score - a.score)
  neg.sort((a, b) => a.score - b.score)

  const transfers = []
  let i = 0, j = 0
  while (i < neg.length && j < pos.length) {
    const debtor = neg[i]
    const creditor = pos[j]
    const amount = Math.min(-debtor.score, creditor.score)
    if (amount > 0) {
      transfers.push({
        fromOpenid: debtor.openid,
        fromName: debtor.nickName,
        toOpenid: creditor.openid,
        toName: creditor.nickName,
        amount
      })
    }
    debtor.score += amount
    creditor.score -= amount
    if (debtor.score === 0) i++
    if (creditor.score === 0) j++
  }
  return transfers
}

/**
 * 计算结算用的净分（含茶水按"曾参与的成员"均摊）
 *
 * @param {Array} members - 房间所有成员（含已退出）
 * @param {Array} orders - 房间所有 orders
 * @returns {{ rawScores: {}, teaTotal: number, teaShare: number, finalScores: {}, summary: [] }}
 *   rawScores: 不含茶水均摊的净分（按 openid）
 *   teaTotal: 茶水总额
 *   teaShare: 每人应分摊的茶水
 *   finalScores: 含茶水均摊的最终净分（用于结算）
 *   summary: 每人详细信息 [{openid, nickName, raw, share, final}]
 */
function computeFinal(members, orders) {
  const rawScores = {}
  const memberMap = {}
  members.forEach(m => {
    rawScores[m.userOpenid] = 0
    memberMap[m.userOpenid] = m
  })

  let teaTotal = 0
  orders.forEach(o => {
    const amt = Number(o.amount) || 0
    if (!o.toOpenid) {
      teaTotal += amt
      rawScores[o.fromOpenid] = (rawScores[o.fromOpenid] || 0) - amt
    } else {
      rawScores[o.fromOpenid] = (rawScores[o.fromOpenid] || 0) - amt
      rawScores[o.toOpenid] = (rawScores[o.toOpenid] || 0) + amt
    }
  })

  // 茶水按"曾参与的成员"均摊
  const n = members.length
  const teaShare = n > 0 ? teaTotal / n : 0

  // 最终净分 = 原始净分 + 已付出的茶水 - 平均茶水
  // 即：付了茶水的，再"领回"自己的那份；没付的，要"出"那份
  // 实际上 rawScores 已经把茶水当作 fromOpenid 的负值扣掉了，
  // 所以最终 = rawScores + teaShare（因为每人应承担 teaShare，但 rawScores 把茶水全扣给付方了，
  // 现在反过来：付方"加回" teaTotal，所有人都"扣" teaShare）
  // 等价做法：把茶水的负值从 rawScores 里加回去，然后每人减 teaShare
  // 简化：直接 finalScores[openid] = rawScores[openid] + teaPaidByMe[openid] - teaShare
  // 我们重新算一次最简单：

  // 先算每人付的茶水
  const teaPaid = {}
  members.forEach(m => { teaPaid[m.userOpenid] = 0 })
  orders.forEach(o => {
    if (!o.toOpenid) {
      teaPaid[o.fromOpenid] = (teaPaid[o.fromOpenid] || 0) + (Number(o.amount) || 0)
    }
  })

  // finalScores[i] = rawScores[i] + teaPaid[i] - teaShare
  // （rawScores 包含了"自己付的茶水扣自己"，现在加回自己付的部分，再分摊全员的 teaShare）
  const finalScores = {}
  const summary = []
  members.forEach(m => {
    const raw = rawScores[m.userOpenid] || 0
    const paid = teaPaid[m.userOpenid] || 0
    // 最终分 = raw + paid - share，但 share 可能是小数，做四舍五入
    const final = Math.round(raw + paid - teaShare)
    finalScores[m.userOpenid] = final
    summary.push({
      openid: m.userOpenid,
      nickName: m.nickName,
      avatarUrl: m.avatarUrl,
      raw,
      teaPaid: paid,
      teaShare,
      final
    })
  })

  return { rawScores, teaTotal, teaShare, finalScores, summary }
}

module.exports = { settle, computeFinal }
