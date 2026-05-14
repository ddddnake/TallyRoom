async function upsertProfile({ nickName, avatarUrl }, openid, db) {
  if (!nickName || nickName.length > 20) {
    return { ok: false, code: 'NO_PROFILE', message: '昵称不能为空且不超过20字' }
  }
  if (!avatarUrl || avatarUrl.length > 500) {
    return { ok: false, code: 'NO_PROFILE', message: '头像地址无效' }
  }

  const { data: existing } = await db.collection('profiles').doc(openid).get().catch(() => ({ data: [] }))

  if (existing && existing.length) {
    await db.collection('profiles').doc(openid).update({
      data: { nickName, avatarUrl, updatedAt: Date.now() }
    })
  } else {
    await db.collection('profiles').add({
      data: {
        _id: openid,
        _openid: openid,
        nickName,
        avatarUrl,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    })
  }

  return { ok: true }
}

module.exports = { upsertProfile }
