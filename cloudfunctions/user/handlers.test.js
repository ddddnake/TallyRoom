const { upsertProfile } = require('./handlers')
const { InMemoryDB, mockServerDate } = require('./lib/in-memory-db')

describe('upsertProfile', () => {
  test('首次创建 profile 成功', async () => {
    const db = new InMemoryDB()
    const openid = 'openid_abc'
    const result = await upsertProfile(
      { nickName: '老王', avatarUrl: 'http://a' },
      openid,
      db
    )
    expect(result.ok).toBe(true)

    const { data } = await db.collection('profiles').doc(openid).get()
    expect(data[0].nickName).toBe('老王')
    expect(data[0].avatarUrl).toBe('http://a')
  })

  test('更新已有 profile', async () => {
    const db = new InMemoryDB()
    db.collection('profiles')._seed([
      { _id: 'openid_abc', _openid: 'openid_abc', nickName: '旧名', avatarUrl: 'x' }
    ])
    const result = await upsertProfile(
      { nickName: '新名', avatarUrl: 'y' },
      'openid_abc',
      db
    )
    expect(result.ok).toBe(true)
    const { data } = await db.collection('profiles').doc('openid_abc').get()
    expect(data[0].nickName).toBe('新名')
  })

  test('空昵称应拒绝', async () => {
    const db = new InMemoryDB()
    const result = await upsertProfile(
      { nickName: '', avatarUrl: 'a' },
      'openid_abc',
      db
    )
    expect(result.ok).toBe(false)
  })

  test('昵称超过 20 字应拒绝', async () => {
    const db = new InMemoryDB()
    const result = await upsertProfile(
      { nickName: 'A'.repeat(21), avatarUrl: 'a' },
      'openid_abc',
      db
    )
    expect(result.ok).toBe(false)
  })

  test('avatarUrl 超过 500 应拒绝', async () => {
    const db = new InMemoryDB()
    const result = await upsertProfile(
      { nickName: 'OK', avatarUrl: 'x'.repeat(501) },
      'openid_abc',
      db
    )
    expect(result.ok).toBe(false)
  })

  test('更新昵称头像后会刷新进行中房间的成员快照', async () => {
    const db = new InMemoryDB()
    // 用户已在两个房间：一个进行中（state=1），一个已退出（state=2）
    db.collection('room_members')._seed([
      { _id: 'm1', roomId: 'r1', userOpenid: 'openid_abc', state: 1, nickName: '旧名', avatarUrl: 'old' },
      { _id: 'm2', roomId: 'r2', userOpenid: 'openid_abc', state: 2, nickName: '旧名', avatarUrl: 'old' },
      { _id: 'm3', roomId: 'r3', userOpenid: 'openid_xyz', state: 1, nickName: '别人', avatarUrl: 'x' }
    ])

    const result = await upsertProfile(
      { nickName: '新名', avatarUrl: 'new' },
      'openid_abc',
      db
    )
    expect(result.ok).toBe(true)
    expect(result.data.refreshed).toBe(1)

    // 进行中房间的成员快照已刷新
    const { data: m1 } = await db.collection('room_members').doc('m1').get()
    expect(m1[0].nickName).toBe('新名')
    expect(m1[0].avatarUrl).toBe('new')

    // 已退出的不刷新
    const { data: m2 } = await db.collection('room_members').doc('m2').get()
    expect(m2[0].nickName).toBe('旧名')

    // 别人的不动
    const { data: m3 } = await db.collection('room_members').doc('m3').get()
    expect(m3[0].nickName).toBe('别人')
  })
})
