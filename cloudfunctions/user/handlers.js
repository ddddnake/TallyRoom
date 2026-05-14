async function upsertProfile({ nickName, avatarUrl }, openid, db) {
  if (!nickName || nickName.length > 20) {
    return { ok: false, code: 'NO_PROFILE', message: '昵称不能为空且不超过20字' }
  }
  if (!avatarUrl || avatarUrl.length > 500) {
    return { ok: false, code: 'NO_PROFILE', message: '头像地址无效' }
  }

  const now = Date.now()

  // 用 doc(openid).set() 实现 upsert
  await db.collection('profiles').doc(openid).set({
    data: {
      _openid: openid,
      nickName,
      avatarUrl,
      createdAt: now,
      updatedAt: now
    }
  })

  // 同步刷新该用户在所有"进行中房间"的成员记录（昵称头像快照）
  // room_orders 是流水，不动，保证历史记录准确性
  let refreshed = 0
  try {
    const memRes = await db.collection('room_members')
      .where({ userOpenid: openid, state: 1 })
      .get()
    for (const m of memRes.data || []) {
      try {
        await db.collection('room_members').doc(m._id).update({
          data: { nickName, avatarUrl }
        })
        refreshed++
      } catch (e) {
        console.error('refresh member failed for', m._id, e)
      }
    }
  } catch (e) {
    console.error('list active memberships failed:', e)
  }

  return { ok: true, data: { refreshed } }
}

module.exports = { upsertProfile }
