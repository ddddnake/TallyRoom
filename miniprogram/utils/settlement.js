/**
 * 最少笔数结算算法
 *
 * @param {Array<{openid, nickName, score}>} balances - 每人的净分数组
 *   score > 0 表示赢，score < 0 表示输，单位"分"
 * @returns {Array<{fromOpenid, fromName, toOpenid, toName, amount}>}
 *   按"输家 → 赢家"方向的结算清单（最少笔数）
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

module.exports = { settle }
