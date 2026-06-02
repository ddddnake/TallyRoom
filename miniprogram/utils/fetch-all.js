// 客户端 wx.cloud.database 单次 .get() 上限是 20 条
// 这个工具把构造好的 query 分页拉完，返回完整数组
const PAGE = 20

async function fetchAll(query) {
  let all = []
  for (let skip = 0; ; skip += PAGE) {
    const res = await query.skip(skip).limit(PAGE).get()
    const batch = res.data || []
    all = all.concat(batch)
    if (batch.length < PAGE) break
  }
  return all
}

module.exports = { fetchAll }
