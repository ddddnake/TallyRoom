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
    expect(result).toEqual({ ok: true })

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
})
