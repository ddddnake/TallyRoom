async function upsertProfile({ nickName, avatarUrl }, openid, db) {
  if (!nickName || nickName.length > 20) {
    return { ok: false, code: 'NO_PROFILE', message: '昵称不能为空且不超过20字' }
  }
  if (!avatarUrl || avatarUrl.length > 500) {
    return { ok: false, code: 'NO_PROFILE', message: '头像地址无效' }
  }

  const now = Date.now()

  // 用 doc(openid).set() 实现 upsert，避免 add() 字段丢失问题
  // 注意：set 不能更新 _id，所以 data 里不放 _id（它由 doc(id) 决定）
  await db.collection('profiles').doc(openid).set({
    data: {
      _openid: openid,
      nickName,
      avatarUrl,
      createdAt: now,
      updatedAt: now
    }
  })

  return { ok: true }
}

module.exports = { upsertProfile }
