const { create, join } = require('./handlers')
const { generate } = require('./lib/code-generator')
const { InMemoryDB } = require('./lib/in-memory-db')
const { NO_PROFILE, ROOM_NOT_FOUND, ROOM_CLOSED } = require('./lib/codes')

// helper: 创建带 profile 的 db
function setupDB() {
  const db = new InMemoryDB()
  db.collection('profiles')._seed([
    { _id: 'a_openid', _openid: 'a_openid', nickName: 'A', avatarUrl: 'x' }
  ])
  return db
}

async function setupRoom(db, ownerOpenid) {
  const roomRes = await create({}, ownerOpenid, db, { generateCode: generate })
  return roomRes.data.roomId
}

async function addMember(db, roomId, openid, nick = '成员') {
  db.collection('profiles')._insert(
    { _id: openid, _openid: openid, nickName: nick, avatarUrl: 'x' }
  )
  const roomData = await db.collection('rooms').doc(roomId).get()
  return join({ code: roomData.data[0].code }, openid, db)
}

describe('create', () => {
  test('创建房间成功', async () => {
    const db = setupDB()
    const result = await create({}, 'a_openid', db, { generateCode: generate })
    expect(result.ok).toBe(true)
    expect(result.data.roomId).toBeDefined()
    expect(result.data.code.length).toBe(6)

    // 验证 rooms 中有记录
    const roomRes = await db.collection('rooms').doc(result.data.roomId).get()
    expect(roomRes.data[0].state).toBe(1)
    expect(roomRes.data[0].ownerOpenid).toBe('a_openid')

    // 验证 members 中房主自动加入
    const memRes = await db.collection('room_members').where({ roomId: result.data.roomId }).get()
    expect(memRes.data.length).toBe(1)
    expect(memRes.data[0].userOpenid).toBe('a_openid')
    expect(memRes.data[0].state).toBe(1)
  })

  test('无 profile 应拒绝', async () => {
    const db = new InMemoryDB()  // 空 profiles
    const result = await create({}, 'unknown', db, { generateCode: generate })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NO_PROFILE')
  })
})

const { leave, close, score } = require('./handlers')

describe('score', () => {
  test('提交计分成功（付A→收B 50，茶水 10）', async () => {
    const db = setupDB()
    db.collection('profiles')._insert(
      { _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'x' }
    )
    const roomId = await setupRoom(db, 'a_openid')
    await addMember(db, roomId, 'b_openid', 'B')

    const result = await score({
      roomId,
      entries: [
        { toOpenid: 'b_openid', amount: 50 },
        { toOpenid: '', amount: 10 }
      ]
    }, 'a_openid', db)

    expect(result.ok).toBe(true)

    // 验证 orders 数量
    const orders = await db.collection('room_orders').where({ roomId }).get()
    expect(orders.data.length).toBe(2)
    // 第一条：A → B 50
    expect(orders.data[0].fromOpenid).toBe('a_openid')
    expect(orders.data[0].toOpenid).toBe('b_openid')
    expect(orders.data[0].amount).toBe(50)
    expect(orders.data[0].fromNickSnap).toBe('A')

    // 第二条：A 茶水 10
    expect(orders.data[1].fromOpenid).toBe('a_openid')
    expect(orders.data[1].toOpenid).toBe('')
    expect(orders.data[1].amount).toBe(10)
  })

  test('非成员提交计分应拒绝', async () => {
    const db = setupDB()
    const roomId = await setupRoom(db, 'a_openid')
    const result = await score({
      roomId,
      entries: [{ toOpenid: 'a_openid', amount: 10 }]
    }, 'stranger_openid', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_MEMBER')
  })

  test('收方不是在场成员应拒绝', async () => {
    const db = setupDB()
    const roomId = await setupRoom(db, 'a_openid')
    const result = await score({
      roomId,
      entries: [{ toOpenid: 'fake_openid', amount: 10 }]
    }, 'a_openid', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_TARGET')
  })

  test('不能给自己转账', async () => {
    const db = setupDB()
    const roomId = await setupRoom(db, 'a_openid')
    const result = await score({
      roomId,
      entries: [{ toOpenid: 'a_openid', amount: 10 }]
    }, 'a_openid', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_TARGET')
  })

  test('金额必须为正', async () => {
    const db = setupDB()
    const roomId = await setupRoom(db, 'a_openid')
    const result = await score({
      roomId,
      entries: [{ toOpenid: '', amount: 0 }]
    }, 'a_openid', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_AMOUNT')
  })
})

describe('join', () => {
  test('通过邀请码加入房间成功', async () => {
    const db = setupDB()
    db.collection('profiles')._insert(
      { _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'y' }
    )
    // 先建一个房
    const roomRes = await create({}, 'a_openid', db, { generateCode: generate })
    const code = roomRes.data.code
    const roomId = roomRes.data.roomId

    const result = await join({ code }, 'b_openid', db)
    expect(result.ok).toBe(true)
    expect(result.data.roomId).toBe(roomId)

    const mems = await db.collection('room_members').where({ roomId }).get()
    expect(mems.data.length).toBe(2)
  })

  test('无此邀请码', async () => {
    const db = setupDB()
    const result = await join({ code: 'XXXXXX' }, 'b_openid', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ROOM_NOT_FOUND')
  })

  test('退出后重新加入（复用记录刷新快照）', async () => {
    const db = setupDB()
    db.collection('profiles')._insert(
      { _id: 'b_openid', _openid: 'b_openid', nickName: '新B', avatarUrl: 'z' }
    )
    const roomRes = await create({}, 'a_openid', db, { generateCode: generate })
    const code = roomRes.data.code

    // B 先加入
    await join({ code }, 'b_openid', db)

    // 手动改为 state=2 模拟退出
    const mems = await db.collection('room_members').where({ userOpenid: 'b_openid' }).get()
    await db.collection('room_members').doc(mems.data[0]._id).update({ data: { state: 2, leftAt: Date.now() } })

    // B 重新加入
    const result = await join({ code }, 'b_openid', db)
    expect(result.ok).toBe(true)

    // 记录被复用，昵称刷新为最新
    const memRes = await db.collection('room_members').doc(mems.data[0]._id).get()
    expect(memRes.data[0].state).toBe(1)
    expect(memRes.data[0].nickName).toBe('新B')
  })

  test('加入已关闭的房间', async () => {
    const db = setupDB()
    const roomRes = await create({}, 'a_openid', db, { generateCode: generate })
    const roomId = roomRes.data.roomId
    await db.collection('rooms').doc(roomId).update({ data: { state: 2 } })

    const result = await join({ code: roomRes.data.code }, 'b_openid', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ROOM_CLOSED')
  })
})

describe('leave', () => {
  test('普通成员退出成功', async () => {
    const db = setupDB()
    db.collection('profiles')._insert({ _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'x' })
    const roomId = await setupRoom(db, 'a_openid')
    await addMember(db, roomId, 'b_openid', 'B')

    const result = await leave({ roomId }, 'b_openid', db)
    expect(result.ok).toBe(true)

    // 成员 state 变为 2
    const memRes = await db.collection('room_members').where({ roomId, userOpenid: 'b_openid' }).get()
    expect(memRes.data[0].state).toBe(2)

    // memberCount 减 1
    const roomRes = await db.collection('rooms').doc(roomId).get()
    expect(roomRes.data[0].memberCount).toBe(1)
  })

  test('房主退出，移交下一成员', async () => {
    const db = setupDB()
    db.collection('profiles')._insert({ _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'x' })
    const roomId = await setupRoom(db, 'a_openid')
    await addMember(db, roomId, 'b_openid', 'B')

    const result = await leave({ roomId }, 'a_openid', db)
    expect(result.ok).toBe(true)

    // ownership 移交到 B
    const roomRes = await db.collection('rooms').doc(roomId).get()
    expect(roomRes.data[0].ownerOpenid).toBe('b_openid')
  })

  test('房主退出，无其他成员，自动关闭', async () => {
    const db = setupDB()
    const roomId = await setupRoom(db, 'a_openid')

    const result = await leave({ roomId }, 'a_openid', db)
    expect(result.ok).toBe(true)

    const roomRes = await db.collection('rooms').doc(roomId).get()
    expect(roomRes.data[0].state).toBe(2)
  })

  test('非成员不能退出', async () => {
    const db = setupDB()
    const roomId = await setupRoom(db, 'a_openid')
    const result = await leave({ roomId }, 'stranger', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_MEMBER')
  })
})

describe('close', () => {
  test('房主关闭房间成功', async () => {
    const db = setupDB()
    const roomId = await setupRoom(db, 'a_openid')

    const result = await close({ roomId }, 'a_openid', db)
    expect(result.ok).toBe(true)

    const roomRes = await db.collection('rooms').doc(roomId).get()
    expect(roomRes.data[0].state).toBe(2)
  })

  test('非房主不能关闭', async () => {
    const db = setupDB()
    db.collection('profiles')._insert({ _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'x' })
    const roomId = await setupRoom(db, 'a_openid')
    await addMember(db, roomId, 'b_openid', 'B')

    const result = await close({ roomId }, 'b_openid', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_OWNER')
  })
})

describe('单房间限制', () => {
  test('已在某进行中房间，再 create 返回 ALREADY_IN_ROOM', async () => {
    const db = setupDB()
    await setupRoom(db, 'a_openid')

    const result = await create({}, 'a_openid', db, { generateCode: generate })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ALREADY_IN_ROOM')
    expect(result.data.roomId).toBeDefined()
  })

  test('已在某进行中房间，加入另一个房间返回 ALREADY_IN_ROOM', async () => {
    const db = setupDB()
    db.collection('profiles')._insert({ _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'x' })

    // a 创建房间 1
    await setupRoom(db, 'a_openid')
    // b 创建房间 2（注意 b 还没在任何房间）
    const r2 = await create({}, 'b_openid', db, { generateCode: generate })
    const code2 = r2.data.code

    // a 想加入房间 2，应被拒绝
    const result = await join({ code: code2 }, 'a_openid', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ALREADY_IN_ROOM')
  })

  test('加入自己已经在的房间是幂等的', async () => {
    const db = setupDB()
    const roomRes = await create({}, 'a_openid', db, { generateCode: generate })
    const code = roomRes.data.code

    // 同一个用户再 join 一次自己创建的房间
    const result = await join({ code }, 'a_openid', db)
    expect(result.ok).toBe(true)
    expect(result.data.roomId).toBe(roomRes.data.roomId)
  })

  test('退出后可以创建新房间', async () => {
    const db = setupDB()
    const r1 = await create({}, 'a_openid', db, { generateCode: generate })
    await leave({ roomId: r1.data.roomId }, 'a_openid', db)

    const r2 = await create({}, 'a_openid', db, { generateCode: generate })
    expect(r2.ok).toBe(true)
  })
})

describe('sweep 自动关闭', () => {
  const { sweep } = require('./handlers')
  const TWELVE_HOURS = 12 * 60 * 60 * 1000

  test('最近活跃的房间不会被关闭', async () => {
    const db = setupDB()
    const r = await create({}, 'a_openid', db, { generateCode: generate })

    const result = await sweep({ roomId: r.data.roomId }, 'a_openid', db)
    expect(result.ok).toBe(true)
    expect(result.data.closed).toBe(0)

    const room = (await db.collection('rooms').doc(r.data.roomId).get()).data[0]
    expect(room.state).toBe(1)
  })

  test('超过 12 小时无活动的房间会被关闭并清理成员', async () => {
    const db = setupDB()
    const r = await create({}, 'a_openid', db, { generateCode: generate })

    // 把房间 createdAt 调成 13 小时前
    const old = Date.now() - 13 * 60 * 60 * 1000
    await db.collection('rooms').doc(r.data.roomId).update({ data: { createdAt: old } })

    const result = await sweep({ roomId: r.data.roomId }, 'a_openid', db)
    expect(result.ok).toBe(true)
    expect(result.data.closed).toBe(1)

    const room = (await db.collection('rooms').doc(r.data.roomId).get()).data[0]
    expect(room.state).toBe(2)

    // 成员也都 state=2
    const mems = await db.collection('room_members').where({ roomId: r.data.roomId, state: 1 }).get()
    expect(mems.data.length).toBe(0)
  })

  test('sweep 后用户可以创建新房间', async () => {
    const db = setupDB()
    const r1 = await create({}, 'a_openid', db, { generateCode: generate })
    // 调旧
    await db.collection('rooms').doc(r1.data.roomId).update({ data: { createdAt: Date.now() - 13 * 60 * 60 * 1000 } })

    // create 内部会先 sweep，应能成功创建新房间
    const r2 = await create({}, 'a_openid', db, { generateCode: generate })
    expect(r2.ok).toBe(true)
    expect(r2.data.roomId).not.toBe(r1.data.roomId)
  })
})
