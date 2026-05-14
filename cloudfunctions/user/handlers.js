async function upsertProfile({ nickName, avatarUrl }, openid, db) {
  if (!nickName || nickName.length > 20) {
    return { ok: false, code: 'NO_PROFILE', message: '昵称不能为空且不超过20字' }
  }
  if (!avatarUrl || avatarUrl.length > 500) {
    return { ok: false, code: 'NO_PROFILE', message: '头像地址无效' }
  }

  // 先尝试 update（已存在的情况最常见）
  const updateRes = await db.collection('profiles').doc(openid).update({
    data: { nickName, avatarUrl, updatedAt: Date.now() }
  }).catch(() => null)

  // update 未命中（文档不存在），执行 add
  if (!updateRes || !updateRes.stats || updateRes.stats.updated === 0) {
    try {
      await db.collection('profiles').add({
        _id: openid,
        _openid: openid,
        nickName,
        avatarUrl,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    } catch (addErr) {
      // 并发情况下可能另一个请求刚好 add 了，此时兜底 update
      if (addErr && addErr.errCode === -502001) {
        await db.collection('profiles').doc(openid).update({
          data: { nickName, avatarUrl, updatedAt: Date.now() }
        })
      } else {
        throw addErr
      }
    }
  }

  return { ok: true }
}

module.exports = { upsertProfile }
