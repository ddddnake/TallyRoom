const { NO_PROFILE, ROOM_NOT_FOUND, ROOM_CLOSED, ALREADY_IN_ROOM } = require('./lib/codes')

// 房间惰性关闭阈值：最后一次活动距今超过 12 小时则自动关闭
const INACTIVITY_THRESHOLD_MS = 12 * 60 * 60 * 1000

// 判定一个进行中的房间是否应该自动关闭；返回 true 表示已关闭
async function _sweepRoomIfStale(room, db) {
  if (!room || room.state !== 1) return false
  const now = Date.now()

  // 取最后一笔订单
  const ordersRes = await db.collection('room_orders')
    .where({ roomId: room._id })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  const lastOrderAt = (ordersRes.data && ordersRes.data[0] && ordersRes.data[0].createdAt) || room.createdAt || 0
  if (now - lastOrderAt < INACTIVITY_THRESHOLD_MS) return false

  // 超时：关闭房间 + 把所有在场成员置为已退出
  await db.collection('rooms').doc(room._id).update({
    data: { state: 2, closedAt: now }
  })
  const members = await db.collection('room_members').where({ roomId: room._id, state: 1 }).get()
  for (const m of members.data || []) {
    await db.collection('room_members').doc(m._id).update({
      data: { state: 2, leftAt: now }
    }).catch(e => console.error('sweep member update failed', m._id, e))
  }
  return true
}

// 查询当前用户参与的进行中房间（已自动 sweep 过期的）
async function _findMyActiveRoom(openid, db) {
  const memRes = await db.collection('room_members')
    .where({ userOpenid: openid, state: 1 })
    .get()
  for (const m of memRes.data || []) {
    const roomRes = await db.collection('rooms').doc(m.roomId).get().catch(() => null)
    const room = roomRes && (Array.isArray(roomRes.data) ? roomRes.data[0] : roomRes.data)
    if (!room || room.state !== 1) continue
    const closed = await _sweepRoomIfStale(room, db)
    if (!closed) return { room, member: m }
  }
  return null
}

async function create(event, openid, db, { generateCode }) {
  // 查 profile
  let profileRes = await db.collection('profiles').where({ _id: openid }).limit(1).get().catch(() => ({ data: [] }))
  if (!profileRes.data || !profileRes.data.length) {
    profileRes = await db.collection('profiles').where({ _openid: openid }).limit(1).get().catch(() => ({ data: [] }))
  }
  console.log('[create] openid:', openid, 'profile found:', profileRes.data && profileRes.data.length)
  if (!profileRes.data || !profileRes.data.length) {
    return { ok: false, code: NO_PROFILE, message: '请先设置头像和昵称' }
  }

  // 单房间限制：先 sweep 过期的，再判断是否还有活跃房间
  const active = await _findMyActiveRoom(openid, db)
  if (active) {
    return {
      ok: false,
      code: ALREADY_IN_ROOM,
      message: '你还在房间「' + active.room.name + '」中，先退出才能创建新房间',
      data: { roomId: active.room._id }
    }
  }

  const nickName = profileRes.data[0].nickName
  const roomName = event.name || nickName + '的房间'
  const now = Date.now()

  // 生成不重复邀请码（内联实现，避免依赖外部模块的兼容问题）
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  function makeCode() {
    let s = ''
    for (let i = 0; i < 6; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)]
    return s
  }

  let code
  for (let attempt = 0; attempt < 10; attempt++) {
    code = makeCode()
    // 确保 code 是有效字符串
    if (!code || code.length !== 6) continue
    const existRes = await db.collection('rooms').where({ code }).get()
    if (!existRes.data.length) break
    code = null
  }
  if (!code || code.length !== 6) {
    return { ok: false, code: 'CODE_GENERATION_FAILED', message: '邀请码生成失败' }
  }

  // 先清理可能存在的 code=null 脏数据
  await db.collection('rooms').where({ code: null }).remove().catch(() => {})

  // 生成 roomId，用 doc(id).set() 替代 add() 避免 add API 的兼容问题
  const roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)

  await db.collection('rooms').doc(roomId).set({
    data: {
      code,
      name: roomName,
      state: 1,
      ownerOpenid: openid,
      _openid: openid,
      memberCount: 1,
      createdAt: now
    }
  })

  // 添加房主为成员
  await db.collection('room_members').add({
    data: {
      roomId,
      userOpenid: openid,
      nickName,
      avatarUrl: profileRes.data[0].avatarUrl,
      state: 1,
      joinedAt: now
    }
  })

  return { ok: true, data: { roomId, code } }
}

async function join(event, openid, db) {
  const { code } = event

  // 查房间
  const roomRes = await db.collection('rooms').where({ code }).get()
  if (!roomRes.data.length) {
    return { ok: false, code: ROOM_NOT_FOUND, message: '房间不存在' }
  }
  const room = roomRes.data[0]
  // 对目标房间先 sweep 一次（可能已经超时该关）
  await _sweepRoomIfStale(room, db)
  // 重读最新状态
  const freshRes = await db.collection('rooms').doc(room._id).get()
  const freshRoom = Array.isArray(freshRes.data) ? freshRes.data[0] : freshRes.data
  if (!freshRoom || freshRoom.state !== 1) {
    return { ok: false, code: ROOM_CLOSED, message: '房间已关闭' }
  }

  // 单房间限制：不能同时在多个进行中房间（但加入"自己已在的房间"是幂等，不算冲突）
  const active = await _findMyActiveRoom(openid, db)
  if (active && active.room._id !== freshRoom._id) {
    return {
      ok: false,
      code: ALREADY_IN_ROOM,
      message: '你还在房间「' + active.room.name + '」中，先退出才能加入新房间',
      data: { roomId: active.room._id }
    }
  }

  // 用最新的 room 字段
  Object.assign(room, freshRoom)
  if (room.state !== 1) {
    return { ok: false, code: ROOM_CLOSED, message: '房间已关闭' }
  }

  // 查 profile（获取最新昵称头像做快照）
  let profileRes = await db.collection('profiles').where({ _id: openid }).limit(1).get().catch(() => ({ data: [] }))
  if (!profileRes.data || !profileRes.data.length) {
    profileRes = await db.collection('profiles').where({ _openid: openid }).limit(1).get().catch(() => ({ data: [] }))
  }
  const nickName = profileRes.data && profileRes.data.length ? profileRes.data[0].nickName : '新成员'
  const avatarUrl = profileRes.data && profileRes.data.length ? profileRes.data[0].avatarUrl : ''

  // 查是否已有 member 记录
  const memRes = await db.collection('room_members').where({ roomId: room._id, userOpenid: openid }).get()

  if (memRes.data.length) {
    const member = memRes.data[0]
    if (member.state === 1) {
      // 已经是成员，幂等
      return { ok: true, data: { roomId: room._id } }
    }
    // state === 2，复用记录重新加入
    await db.runTransaction(async (tx) => {
      await tx.collection('room_members').doc(member._id).update({
        data: {
          state: 1,
          leftAt: null,
          nickName,
          avatarUrl
        }
      })
      await tx.collection('rooms').doc(room._id).update({
        data: { memberCount: room.memberCount + 1 }
      })
    })
    return { ok: true, data: { roomId: room._id } }
  }

  // 新成员
  const now = Date.now()
  await db.collection('room_members').add({
    data: {
      roomId: room._id,
      userOpenid: openid,
      nickName,
      avatarUrl,
      state: 1,
      joinedAt: now
    }
  })
  await db.collection('rooms').doc(room._id).update({
    data: { memberCount: room.memberCount + 1 }
  })

  return { ok: true, data: { roomId: room._id } }
}

async function score(event, openid, db) {
  const { roomId, entries } = event
  const { NOT_MEMBER, ROOM_CLOSED, INVALID_AMOUNT, INVALID_TARGET } = require('./lib/codes')

  if (!Array.isArray(entries) || !entries.length) {
    return { ok: false, code: INVALID_AMOUNT, message: '请至少填写一项' }
  }

  // 校验当前用户是成员
  const myMem = await db.collection('room_members').where({ roomId, userOpenid: openid, state: 1 }).get()
  if (!myMem.data.length) {
    return { ok: false, code: NOT_MEMBER, message: '你不是该房间成员' }
  }

  // 校验房间（云端 doc().get() 返回 { data: 单对象 }，本地 mock 返回 { data: [对象] }，兼容两种）
  const roomRes = await db.collection('rooms').doc(roomId).get()
  const roomDoc = Array.isArray(roomRes.data) ? roomRes.data[0] : roomRes.data
  if (!roomDoc || roomDoc.state !== 1) {
    return { ok: false, code: ROOM_CLOSED, message: '房间已关闭' }
  }

  // 取所有在场成员
  const allMembers = await db.collection('room_members').where({ roomId, state: 1 }).get()
  const memberOpenids = new Set(allMembers.data.map(m => m.userOpenid))
  const memberMap = {}
  allMembers.data.forEach(m => { memberMap[m.userOpenid] = m })

  // 校验 entries
  for (const e of entries) {
    if (!Number.isInteger(e.amount) || e.amount <= 0) {
      return { ok: false, code: INVALID_AMOUNT, message: '金额必须为正整数' }
    }
    if (e.toOpenid !== '' && e.toOpenid !== undefined && e.toOpenid !== null) {
      if (e.toOpenid === openid) {
        return { ok: false, code: INVALID_TARGET, message: '不能给自己转账' }
      }
      if (!memberOpenids.has(e.toOpenid)) {
        return { ok: false, code: INVALID_TARGET, message: '收款方不是在场成员' }
      }
    }
  }

  const fromNickSnap = myMem.data[0].nickName
  const now = Date.now()

  // 逐条写入 orders
  for (const e of entries) {
    let toNickSnap = ''
    if (e.toOpenid && memberMap[e.toOpenid]) {
      toNickSnap = memberMap[e.toOpenid].nickName
    }
    await db.collection('room_orders').add({
      data: {
        roomId,
        fromOpenid: openid,
        toOpenid: e.toOpenid || '',
        amount: e.amount,
        fromNickSnap,
        toNickSnap,
        createdAt: now
      }
    })
  }

  return { ok: true, data: { count: entries.length } }
}

async function leave(event, openid, db) {
  const { roomId } = event
  const { NOT_MEMBER } = require('./lib/codes')

  // 校验是成员
  const myMem = await db.collection('room_members').where({ roomId, userOpenid: openid, state: 1 }).get()
  if (!myMem.data.length) {
    return { ok: false, code: NOT_MEMBER, message: '你不是该房间成员' }
  }

  const roomRes = await db.collection('rooms').doc(roomId).get()
  const room = roomRes.data[0] || roomRes.data

  const isOwner = room.ownerOpenid === openid
  const now = Date.now()

  if (!isOwner) {
    // 普通成员直接退出
    await db.runTransaction(async (tx) => {
      await tx.collection('room_members').doc(myMem.data[0]._id).update({
        data: { state: 2, leftAt: now }
      })
      await tx.collection('rooms').doc(roomId).update({
        data: { memberCount: room.memberCount - 1 }
      })
    })
    return { ok: true }
  }

  // 房主：尝试移交
  const allMembers = await db.collection('room_members').where({ roomId, state: 1 }).get()
  const nextOwner = allMembers.data.find(m => m.userOpenid !== openid)

  await db.runTransaction(async (tx) => {
    await tx.collection('room_members').doc(myMem.data[0]._id).update({
      data: { state: 2, leftAt: now }
    })

    if (nextOwner) {
      await tx.collection('rooms').doc(roomId).update({
        data: {
          ownerOpenid: nextOwner.userOpenid,
          memberCount: room.memberCount - 1
        }
      })
    } else {
      // 无人可移交，自动关闭
      await tx.collection('rooms').doc(roomId).update({
        data: {
          state: 2,
          closedAt: now,
          memberCount: room.memberCount - 1
        }
      })
    }
  })

  return { ok: true }
}

async function close(event, openid, db) {
  const { roomId } = event
  const { NOT_OWNER } = require('./lib/codes')

  const roomRes = await db.collection('rooms').doc(roomId).get()
  const room = roomRes.data[0] || roomRes.data

  if (room.ownerOpenid !== openid) {
    return { ok: false, code: NOT_OWNER, message: '仅房主可以关闭房间' }
  }

  await db.collection('rooms').doc(roomId).update({
    data: { state: 2, closedAt: Date.now() }
  })

  return { ok: true }
}

// 扫描当前用户所有 state=1 的房间，惰性关闭超时房间
// 入参：{ roomId? }  传则只扫该房间，不传则扫我所有进行中的房间
async function sweep(event, openid, db) {
  const { roomId } = event || {}
  let closed = 0
  if (roomId) {
    const roomRes = await db.collection('rooms').doc(roomId).get().catch(() => null)
    const room = roomRes && (Array.isArray(roomRes.data) ? roomRes.data[0] : roomRes.data)
    if (room && (await _sweepRoomIfStale(room, db))) closed++
    return { ok: true, data: { closed } }
  }

  const memRes = await db.collection('room_members')
    .where({ userOpenid: openid, state: 1 })
    .get()
  const seen = new Set()
  for (const m of memRes.data || []) {
    if (seen.has(m.roomId)) continue
    seen.add(m.roomId)
    const roomRes = await db.collection('rooms').doc(m.roomId).get().catch(() => null)
    const room = roomRes && (Array.isArray(roomRes.data) ? roomRes.data[0] : roomRes.data)
    if (!room) continue
    if (await _sweepRoomIfStale(room, db)) closed++
  }
  return { ok: true, data: { closed } }
}

module.exports = { create, join, score, leave, close, sweep }

