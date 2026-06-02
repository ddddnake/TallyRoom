# 微信打牌记账小程序实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.  
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在微信云开发上搭建"打牌记账"小程序，支持建房/加入/计分/实时同步/茶水费/历史记录

**Architecture:** 读直连 `db.watch` 实时订阅 + 写走云函数集中校验。单一云函数 `room` 按 action 分发（create/join/score/leave/close），辅助 `user` 云函数处理昵称头像。3 个前端页面 + 1 个首次引导页，UI 照搬参考项目布局。

**Tech Stack:** 微信小程序原生 + 云开发（Node 16）+ Vant Weapp + Jest（云函数单测）

**前置条件：**
- [ ] 小程序 AppID 已注册
- [ ] 微信云开发已在 AppID 下开通并创建环境

---

## 文件结构

```
TallyRoom/
├── .gitignore
├── project.config.json
├── miniprogram/
│   ├── app.js, app.json, app.wxss
│   ├── package.json                 # Vant Weapp
│   ├── utils/
│   │   ├── cloud.js                 # 统一调用云函数 + 错误处理
│   │   ├── aggregate.js             # 前端聚合（净分/茶水/消息流）
│   │   ├── format.js                # 时间/金额格式化
│   │   └── error-messages.js        # 错误码 → 中文文案表
│   ├── images/
│   │   └── (参考项目 kopieren 过来的图标)
│   └── pages/
│       ├── setup/profile/           # 首次引导（选头像+填昵称）
│       ├── index/                   # 首页（创建/加入/统计/历史入口）
│       ├── room/detail/             # 房间页（核心：成员横滚+消息流+计分+操作）
│       └── history/list/            # 历史房间列表
├── cloudfunctions/
│   ├── room/
│   │   ├── index.js                 # 入口：解 action 调 handlers
│   │   ├── handlers.js              # 6 个 action 纯函数
│   │   ├── handlers.test.js
│   │   ├── lib/codes.js             # 错误码常量
│   │   ├── lib/code-generator.js    # 6 位邀请码生成
│   │   ├── lib/code-generator.test.js
│   │   ├── lib/in-memory-db.js      # 测试用最小数据库 mock
│   │   └── package.json
│   └── user/
│       ├── index.js
│       ├── handlers.js
│       ├── handlers.test.js
│       ├── lib/in-memory-db.js      # 同上（两份拷贝避免跨 cloudfunction 引用）
│       └── package.json
```

> 注：每个云函数的 `node_modules` 最终在 WeChat DevTools 上传，cloudfunctions 下的 `package.json` 仅声明 wx-server-sdk 依赖。

---

### Task 0: git init 与 .gitignore

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: 初始化 git 仓库**

```bash
cd D:/AI/TallyRoom && git init
```

- [ ] **Step 2: 写 .gitignore**

Write `D:/AI/TallyRoom/.gitignore`:

```gitignore
node_modules/
miniprogram_npm/
reference-app/
*.rar
.DS_Store
```

- [ ] **Step 3: 首次提交**

```bash
git add .gitignore docs/ && git commit -m "chore: init repo with design doc"
```

---

### Task 1: 项目骨架与配置

**Files:**
- Create: `project.config.json`
- Create: `miniprogram/app.js`
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.wxss`

- [ ] **Step 1: 创建 project.config.json**

Write `D:/AI/TallyRoom/project.config.json`:

```json
{
  "miniprogramRoot": "miniprogram/",
  "cloudfunctionRoot": "cloudfunctions/",
  "cloudbaseRoot": "cloudfunctions/",
  "setting": {
    "es6": true,
    "enhance": true,
    "postcss": true,
    "minified": true,
    "urlCheck": false,
    "checkSiteMap": false
  },
  "compileType": "miniprogram",
  "appid": "YOUR_APPID_HERE",
  "projectname": "tally-room"
}
```

> 配置后手动在 WeChat DevTools 中替换 `YOUR_APPID_HERE` 为真实 AppID。

- [ ] **Step 2: 创建 miniprogram/app.json**

```json
{
  "pages": [
    "pages/setup/profile",
    "pages/index/index",
    "pages/room/detail",
    "pages/history/list"
  ],
  "window": {
    "backgroundTextStyle": "dark",
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTitleText": "",
    "navigationBarTextStyle": "black"
  },
  "sitemapLocation": "sitemap.json",
  "usingComponents": {
    "van-button": "@vant/weapp/button/index",
    "van-icon": "@vant/weapp/icon/index",
    "van-empty": "@vant/weapp/empty/index",
    "van-popup": "@vant/weapp/popup/index",
    "van-tag": "@vant/weapp/tag/index",
    "van-cell": "@vant/weapp/cell/index",
    "van-cell-group": "@vant/weapp/cell-group/index",
    "van-field": "@vant/weapp/field/index",
    "van-dialog": "@vant/weapp/dialog/index",
    "van-toast": "@vant/weapp/toast/index",
    "van-loading": "@vant/weapp/loading/index"
  },
  "tabBar": {
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "首页",
        "iconPath": "images/tab/home.png",
        "selectedIconPath": "images/tab/home-active.png"
      },
      {
        "pagePath": "pages/history/list",
        "text": "历史",
        "iconPath": "images/tab/history.png",
        "selectedIconPath": "images/tab/history-active.png"
      }
    ]
  },
  "lazyCodeLoading": "requiredComponents"
}
```

- [ ] **Step 3: 创建 miniprogram/app.js**

```js
App({
  onLaunch() {
    wx.cloud.init({ env: 'TALLY_ENV' })
    this._profilePromise = null
  },

  /** 获取当前 openid 对应的 profile，无则返回 null，供首页判断是否需要引导 */
  getProfile() {
    if (this._profilePromise) return this._profilePromise

    this._profilePromise = wx.cloud.database()
      .collection('profiles')
      .limit(1)
      .get()
      .then(res => {
        this._profilePromise = null
        return res.data && res.data.length ? res.data[0] : null
      })
      .catch(e => {
        this._profilePromise = null
        console.error('getProfile failed', e)
        return null
      })

    return this._profilePromise
  },

  /** 让首页强制重新获取 profile（设置完昵称头像后调用） */
  clearProfileCache() {
    this._profilePromise = null
  }
})
```

- [ ] **Step 4: 创建 miniprogram/app.wxss**

```css
page {
  --color-primary: #ff5032;
  --color-success: #52c41a;
  --color-warning: #fa8c16;
  --color-bg: #f5f5f5;
  --color-card: #ffffff;
  --color-text: #333333;
  --color-text-secondary: #999999;
  box-sizing: border-box;
}
```

- [ ] **Step 5: 创建 sitemap.json**

```json
{"rules":[{"action":"allow","page":"*"}]}
```

- [ ] **Step 6: 提交**

```bash
git add project.config.json miniprogram/app.js miniprogram/app.json miniprogram/app.wxss sitemap.json && git commit -m "feat: project skeleton and app entry"
```

---

### Task 2: 前端工具模块

**Files:**
- Create: `miniprogram/utils/cloud.js`
- Create: `miniprogram/utils/error-messages.js`
- Create: `miniprogram/utils/format.js`
- Create: `miniprogram/utils/aggregate.js`

- [ ] **Step 1: 创建 miniprogram/utils/error-messages.js**

```js
const MAP = {
  NO_PROFILE: '请先设置头像和昵称',
  ROOM_NOT_FOUND: '房间不存在',
  ROOM_CLOSED: '房间已关闭',
  NOT_MEMBER: '你不是当前房间成员',
  NOT_OWNER: '仅房主可以执行此操作',
  INVALID_AMOUNT: '金额必须为正整数',
  INVALID_TARGET: '收款方无效',
  CODE_GENERATION_FAILED: '邀请码生成失败，请重试',
  UNKNOWN: '服务异常，请重试'
}

module.exports = {
  getMessage(code) {
    return MAP[code] || MAP['UNKNOWN']
  }
}
```

- [ ] **Step 2: 创建 miniprogram/utils/cloud.js**

```js
const { getMessage } = require('./error-messages')

/**
 * 统一调用云函数，返回 { ok, data }
 * ok: false 时自动 toast 中文错误信息
 */
function call(name, data = {}) {
  return wx.cloud.callFunction({ name, data })
    .then(res => {
      const result = res.result || {}
      if (!result.ok) {
        wx.showToast({ title: getMessage(result.code), icon: 'none', duration: 2500 })
        return { ok: false, code: result.code }
      }
      return { ok: true, data: result.data }
    })
    .catch(e => {
      console.error('callFunction error', name, e)
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
      return { ok: false, code: 'NETWORK_ERROR' }
    })
}

module.exports = { call }
```

- [ ] **Step 3: 创建 miniprogram/utils/format.js**（保留原项目逻辑）

```js
function formatTime(date) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const n = v => (v < 10 ? '0' + v : v)
  return `${[year, month, day].map(n).join('/')} ${[hour, minute].map(n).join(':')}`
}

function toAmount(num) {
  if (!num) return '0.00'
  return parseFloat(num).toFixed(2)
}

module.exports = { formatTime, toAmount }
```

- [ ] **Step 4: 创建 miniprogram/utils/aggregate.js**

```js
/**
 * 按 room_orders + room_members 计算每人净分、茶水合计、消息流
 * @param {Array} orders - room_orders 数组
 * @param {Array} members - room_members 数组 (state=1)
 * @returns {{ userScores: {}, teaTotal: number, messages: Array }}
 */
function compute(orders, members) {
  const userScores = {}
  let teaTotal = 0

  // 初始化所有在场成员分数为 0
  members.forEach(m => { userScores[m.userOpenid] = 0 })

  orders.forEach(o => {
    const amt = Number(o.amount) || 0
    if (!o.toOpenid || o.toOpenid === '') {
      // 茶水：付出方减，入茶水池
      teaTotal += amt
      userScores[o.fromOpenid] = (userScores[o.fromOpenid] || 0) - amt
    } else {
      // 记分：付方减，收方加
      userScores[o.fromOpenid] = (userScores[o.fromOpenid] || 0) - amt
      userScores[o.toOpenid] = (userScores[o.toOpenid] || 0) + amt
    }
  })

  // 生成消息流文案
  const memberMap = {}
  members.forEach(m => { memberMap[m.userOpenid] = m.nickName })

  const messages = orders.map(o => {
    const fromName = o.fromNickSnap || memberMap[o.fromOpenid] || o.fromOpenid
    if (!o.toOpenid || o.toOpenid === '') {
      return { text: `${fromName} 付茶水 ${o.amount} 分`, time: o.createdAt, id: o._id }
    }
    const toName = o.toNickSnap || memberMap[o.toOpenid] || o.toOpenid
    return { text: `${fromName} → ${toName} ${o.amount} 分`, time: o.createdAt, id: o._id }
  })

  return { userScores, teaTotal, messages }
}

module.exports = { compute }
```

- [ ] **Step 5: 提交**

```bash
git add miniprogram/utils/ && git commit -m "feat: frontend utility modules"
```

---

### Task 3: 云函数 room · 基础组件（邀请码生成器 + 测试用内存 DB）

**Files:**
- Create: `cloudfunctions/room/package.json`
- Create: `cloudfunctions/room/lib/codes.js`
- Create: `cloudfunctions/room/lib/code-generator.js`
- Create: `cloudfunctions/room/lib/code-generator.test.js`
- Create: `cloudfunctions/room/lib/in-memory-db.js`

- [ ] **Step 1: 创建 cloudfunctions/room/package.json**

```json
{
  "name": "tally-room-cloud-function",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3"
  },
  "scripts": {
    "test": "jest"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}
```

运行：`cd cloudfunctions/room && npm install`

- [ ] **Step 2: 创建 cloudfunctions/room/lib/codes.js**

```js
module.exports = {
  NO_PROFILE: 'NO_PROFILE',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_CLOSED: 'ROOM_CLOSED',
  NOT_MEMBER: 'NOT_MEMBER',
  NOT_OWNER: 'NOT_OWNER',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_TARGET: 'INVALID_TARGET',
  CODE_GENERATION_FAILED: 'CODE_GENERATION_FAILED'
}
```

- [ ] **Step 3: 写 code-generator 的失败测试**

Write `cloudfunctions/room/lib/code-generator.test.js`:

```js
const { generate } = require('./code-generator')

describe('code-generator', () => {
  test('生成长度为 6 的字符串', () => {
    const code = generate()
    expect(code.length).toBe(6)
  })

  test('只用大写字母和数字', () => {
    for (let i = 0; i < 100; i++) {
      const code = generate()
      expect(code).toMatch(/^[A-Z0-9]+$/)
    }
  })

  test('不包含易混字符 O/0/I/1', () => {
    for (let i = 0; i < 100; i++) {
      const code = generate()
      expect(code).not.toMatch(/[O0I1]/)
    }
  })

  test('连续 1000 次无重复', () => {
    const set = new Set()
    for (let i = 0; i < 1000; i++) {
      set.add(generate())
    }
    expect(set.size).toBe(1000)
  })
})
```

- [ ] **Step 4: 运行测试，确认失败**

```bash
cd cloudfunctions/room && npx jest lib/code-generator.test.js
```
预期：`Cannot find module './code-generator'`

- [ ] **Step 5: 实现 code-generator**

Write `cloudfunctions/room/lib/code-generator.js`:

```js
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 排除 O/0/I/1

function generate() {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

module.exports = { generate }
```

- [ ] **Step 6: 运行测试，确认通过**

```bash
cd cloudfunctions/room && npx jest lib/code-generator.test.js
```
预期：4 tests PASS

- [ ] **Step 7: 创建测试用内存数据库 mock**

Write `cloudfunctions/room/lib/in-memory-db.js`:

```js
/**
 * 云函数 handler 测试用的最小数据库 mock。
 * 实现 collection().doc()/where()/get()/update()/add()/runTransaction()（部分）
 */
class InMemoryDB {
  constructor() {
    this._collections = {}
  }

  collection(name) {
    if (!this._collections[name]) {
      this._collections[name] = new Collection(name)
    }
    return this._collections[name]
  }

  /**
   * 启动"事务"——实际上就是一个同步包装器。
   * 云端是 runTransaction，这里我们用内存模拟一样的行为：
   * 传入函数 fn(transaction)，返回 fn 的结果。
   */
  async runTransaction(fn) {
    return fn({
      collection: (name) => this.collection(name)
    })
  }
}

class Collection {
  constructor(name) {
    this.name = name
    this._records = []
    this._nextId = 1
  }

  _seed(records) {
    this._records = records.map(r => ({ ...r }))
    this._nextId = Math.max(0, ...records.map(r => r._id || 0)) + 1
  }

  doc(id) {
    const rec = this._records.find(r => r._id === id)
    return {
      get: async () => {
        if (!rec) throw new Error(`doc ${id} not found in ${this.name}`)
        return { data: [rec] }
      },
      update: async ({ data }) => {
        if (!rec) throw new Error(`doc ${id} not found in ${this.name}`)
        Object.assign(rec, data)
        return { stats: { updated: 1 } }
      }
    }
  }

  where(query) {
    const records = this._records
    return {
      get: async () => {
        const matched = records.filter(r => {
          return Object.entries(query).every(([k, v]) => r[k] === v)
        })
        return { data: matched }
      },
      orderBy(field, dir) {
        return {
          get: async () => {
            const matched = records.filter(r => {
              return Object.entries(query).every(([k, v]) => r[k] === v)
            })
            matched.sort((a, b) => {
              const va = a[field], vb = b[field]
              return dir === 'desc' ? vb - va : va - vb
            })
            return { data: matched }
          }
        }
      },
      limit(n) {
        return {
          get: async () => {
            const matched = records.filter(r => {
              return Object.entries(query).every(([k, v]) => r[k] === v)
            })
            return { data: matched.slice(0, n) }
          }
        }
      }
    }
  }

  add({ data }) {
    const rec = { _id: String(this._nextId++), ...data }
    this._records.push(rec)
    return { _id: rec._id }
  }
}

// 辅助：生成 mock serverDate
const MOCK_NOW = Date.now()
function mockServerDate() { return MOCK_NOW }

module.exports = { InMemoryDB, mockServerDate }
```

- [ ] **Step 8: 提交**

```bash
git add cloudfunctions/room/ && git commit -m "feat: room cloud function - test infra, codes, code-generator"
```

---

### Task 4: 云函数 user · upsertProfile

**Files:**
- Create: `cloudfunctions/user/package.json`
- Create: `cloudfunctions/user/index.js`
- Create: `cloudfunctions/user/handlers.js`
- Create: `cloudfunctions/user/handlers.test.js`
- Create: `cloudfunctions/user/lib/in-memory-db.js`

- [ ] **Step 1: 创建 cloudfunctions/user/package.json**

```json
{
  "name": "tally-user-cloud-function",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3"
  },
  "scripts": {
    "test": "jest"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}
```

运行：`cd cloudfunctions/user && npm install`

- [ ] **Step 2: 拷贝 in-memory-db**

```bash
cp cloudfunctions/room/lib/in-memory-db.js cloudfunctions/user/lib/in-memory-db.js
```

- [ ] **Step 3: 写 upsertProfile 测试**

Write `cloudfunctions/user/handlers.test.js`:

```js
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
```

- [ ] **Step 4: 运行测试，确认失败**

```bash
cd cloudfunctions/user && npx jest handlers.test.js
```
预期：全部 FAIL

- [ ] **Step 5: 实现 handlers.js**

Write `cloudfunctions/user/handlers.js`:

```js
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
```

- [ ] **Step 6: 运行测试，确认通过**

```bash
cd cloudfunctions/user && npx jest handlers.test.js
```
预期：5 tests PASS

- [ ] **Step 7: 实现 cloudfunctions/user/index.js**（云函数入口）

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { upsertProfile } = require('./handlers')

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, ...data } = event

  switch (action) {
    case 'upsertProfile':
      return upsertProfile(data, OPENID, cloud.database())
    default:
      return { ok: false, code: 'UNKNOWN_ACTION', message: `未知 action: ${action}` }
  }
}
```

- [ ] **Step 8: 提交**

```bash
git add cloudfunctions/user/ && git commit -m "feat: user cloud function - upsertProfile"
```

---

### Task 5: 云函数 room · create 与 join

**Files:**
- Create: `cloudfunctions/room/index.js`
- Create: `cloudfunctions/room/handlers.js`
- Modify: `cloudfunctions/room/handlers.test.js`（追加 create/join 测试）

- [ ] **Step 1: 写 create 和 join 的测试**

Write `cloudfunctions/room/lib/handlers-test.js`:

```js
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

describe('join', () => {
  test('通过邀请码加入房间成功', async () => {
    const db = setupDB()
    db.collection('profiles')._seed([
      { _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'y' }
    ])
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
    db.collection('profiles')._seed([
      { _id: 'b_openid', _openid: 'b_openid', nickName: '新B', avatarUrl: 'z' }
    ])
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd cloudfunctions/room && npx jest handlers.test.js
```
预期：全部 FAIL（handlers.js 还未创建）

- [ ] **Step 3: 实现 create 和 join handler**

Write `cloudfunctions/room/handlers.js`:

```js
const { NO_PROFILE, ROOM_NOT_FOUND, ROOM_CLOSED } = require('./lib/codes')

async function create(event, openid, db, { generateCode }) {
  // 查 profile
  const profileRes = await db.collection('profiles').doc(openid).get().catch(() => ({ data: [] }))
  if (!profileRes.data || !profileRes.data.length) {
    return { ok: false, code: NO_PROFILE, message: '请先设置头像和昵称' }
  }

  const nickName = profileRes.data[0].nickName
  const roomName = event.name || nickName + '的房间'

  // 生成不重复邀请码
  let code
  for (let i = 0; i < 5; i++) {
    code = generateCode()
    const existRes = await db.collection('rooms').where({ code }).get()
    if (!existRes.data.length) break
  }
  if (!code) return { ok: false, code: 'CODE_GENERATION_FAILED' }

  const now = Date.now()

  // 事务：写 rooms + room_members
  const result = await db.runTransaction(async (tx) => {
    const roomAdd = await tx.collection('rooms').add({
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

    await tx.collection('room_members').add({
      data: {
        roomId: roomAdd._id,
        userOpenid: openid,
        nickName,
        avatarUrl: profileRes.data[0].avatarUrl,
        state: 1,
        joinedAt: now
      }
    })

    return { roomId: roomAdd._id, code }
  })

  return { ok: true, data: result }
}

async function join(event, openid, db) {
  const { code } = event

  // 查房间
  const roomRes = await db.collection('rooms').where({ code }).get()
  if (!roomRes.data.length) {
    return { ok: false, code: ROOM_NOT_FOUND, message: '房间不存在' }
  }
  const room = roomRes.data[0]
  if (room.state !== 1) {
    return { ok: false, code: ROOM_CLOSED, message: '房间已关闭' }
  }

  // 查 profile（获取最新昵称头像做快照）
  const profileRes = await db.collection('profiles').doc(openid).get().catch(() => ({ data: [] }))
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
  await db.runTransaction(async (tx) => {
    await tx.collection('room_members').add({
      data: {
        roomId: room._id,
        userOpenid: openid,
        nickName,
        avatarUrl,
        state: 1,
        joinedAt: now
      }
    })
    await tx.collection('rooms').doc(room._id).update({
      data: { memberCount: room.memberCount + 1 }
    })
  })

  return { ok: true, data: { roomId: room._id } }
}

module.exports = { create, join }
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd cloudfunctions/room && npx jest handlers.test.js
```
预期：create(2) + join(4) = 6 tests PASS（假设 code-generator 的 4 个测试在另一个文件）

- [ ] **Step 5: 实现 cloudfunctions/room/index.js**（入口）

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handlers = require('./handlers')
const { generate } = require('./lib/code-generator')

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, ...data } = event

  switch (action) {
    case 'create':
      return handlers.create(data, OPENID, cloud.database(), { generateCode: generate })
    case 'join':
      return handlers.join(data, OPENID, cloud.database())
    default:
      return { ok: false, code: 'UNKNOWN_ACTION', message: `未知 action: ${action}` }
  }
}
```

- [ ] **Step 6: 提交**

```bash
git add cloudfunctions/room/handlers.js cloudfunctions/room/index.js cloudfunctions/room/lib/handlers-test.js && git commit -m "feat: room cloud function - create and join"
```

---

### Task 6: 云函数 room · score

**Files:**
- Modify: `cloudfunctions/room/handlers.js`（追加 score）
- Modify: `cloudfunctions/room/handlers.test.js`（追加 score 测试）
- Modify: `cloudfunctions/room/index.js`（追加 case 'score'）

- [ ] **Step 1: 写 score 测试**

追加到 `cloudfunctions/room/lib/handlers-test.js`:

```js
const { score } = require('./handlers')

describe('score', () => {
  async function setupRoom(db, ownerOpenid) {
    const roomRes = await create({}, ownerOpenid, db, { generateCode: generate })
    return roomRes.data.roomId
  }

  async function addMember(db, roomId, openid, nick = '成员') {
    db.collection('profiles')._seed([
      { _id: openid, _openid: openid, nickName: nick, avatarUrl: 'x' }
    ])
    return join({ code: (await db.collection('rooms').doc(roomId).get()).data[0].code }, openid, db)
  }

  test('提交计分成功（付A→收B 50，茶水 10）', async () => {
    const db = setupDB()
    db.collection('profiles')._seed([
      { _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'x' }
    ])
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

  test('不能给自己记分', async () => {
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd cloudfunctions/room && npx jest handlers.test.js
```
预期：score 相关测试全部 FAIL

- [ ] **Step 3: 实现 score handler**

追加到 `cloudfunctions/room/handlers.js`:

```js
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

  // 校验房间
  const roomRes = await db.collection('rooms').doc(roomId).get()
  if (!roomRes.data.length || roomRes.data[0].state !== 1) {
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
        return { ok: false, code: INVALID_TARGET, message: '不能给自己记分' }
      }
      if (!memberOpenids.has(e.toOpenid)) {
        return { ok: false, code: INVALID_TARGET, message: '收款方不是在场成员' }
      }
    }
  }

  const fromNickSnap = myMem.data[0].nickName
  const now = Date.now()

  // 事务批量写 orders
  await db.runTransaction(async (tx) => {
    for (const e of entries) {
      let toNickSnap = ''
      if (e.toOpenid && memberMap[e.toOpenid]) {
        toNickSnap = memberMap[e.toOpenid].nickName
      }
      await tx.collection('room_orders').add({
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
  })

  return { ok: true, data: { count: entries.length } }
}
```

- [ ] **Step 4: 追加 index.js 的 action 分支**

在 `cloudfunctions/room/index.js` 的 switch 中追加：

```js
case 'score':
  return handlers.score(data, OPENID, cloud.database())
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
cd cloudfunctions/room && npx jest handlers.test.js
```
预期：create(2) + join(4) + score(5) = 11 tests PASS

- [ ] **Step 6: 提交**

```bash
git add cloudfunctions/room/ && git commit -m "feat: room cloud function - score"
```

---

### Task 7: 云函数 room · leave 与 close

**Files:**
- Modify: `cloudfunctions/room/handlers.js`（追加 leave/close）
- Modify: `cloudfunctions/room/handlers.test.js`（追加 leave/close 测试）
- Modify: `cloudfunctions/room/index.js`（追加 case 分支）

- [ ] **Step 1: 写 leave 和 close 测试**

追加到 `cloudfunctions/room/lib/handlers-test.js`:

```js
const { leave, close } = require('./handlers')

describe('leave', () => {
  test('普通成员退出成功', async () => {
    const db = setupDB()
    db.collection('profiles')._seed([
      { _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'x' }
    ])
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
    db.collection('profiles')._seed([
      { _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'x' }
    ])
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
    db.collection('profiles')._seed([
      { _id: 'b_openid', _openid: 'b_openid', nickName: 'B', avatarUrl: 'x' }
    ])
    const roomId = await setupRoom(db, 'a_openid')
    await addMember(db, roomId, 'b_openid', 'B')

    const result = await close({ roomId }, 'b_openid', db)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_OWNER')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd cloudfunctions/room && npx jest handlers.test.js
```
预期：leave/close 相关测试全部 FAIL

- [ ] **Step 3: 实现 leave 和 close handler**

追加到 `cloudfunctions/room/handlers.js`:

```js
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
```

- [ ] **Step 4: 追加 index.js 的 action 分支**

在 `cloudfunctions/room/index.js` 的 switch 中追加：

```js
case 'leave':
  return handlers.leave(data, OPENID, cloud.database())
case 'close':
  return handlers.close(data, OPENID, cloud.database())
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
cd cloudfunctions/room && npx jest handlers.test.js
```
预期：create(2) + join(4) + score(5) + leave(4) + close(2) = 17 tests PASS

- [ ] **Step 6: 提交**

```bash
git add cloudfunctions/room/ && git commit -m "feat: room cloud function - leave and close"
```

---

以下是前端页面实现。每个页面都继承参考项目的视觉风格，替换网络层为我们的 `utils/cloud.js`。

### Task 8: 首次引导页 (pages/setup/profile)

**Files:**
- Create: `miniprogram/pages/setup/profile.js`
- Create: `miniprogram/pages/setup/profile.wxml`
- Create: `miniprogram/pages/setup/profile.wxss`
- Create: `miniprogram/pages/setup/profile.json`

- [ ] **Step 1: 创建 miniprogram/pages/setup/profile.json**

```json
{
  "usingComponents": {
    "van-button": "@vant/weapp/button/index",
    "van-icon": "@vant/weapp/icon/index"
  }
}
```

- [ ] **Step 2: 创建 profile.wxml**

```xml
<view class="setup-page">
  <view class="setup-header">
    <text class="setup-title">欢迎使用打牌记账</text>
    <text class="setup-desc">先设置你的头像和昵称</text>
  </view>

  <view class="setup-avatar">
    <button class="avatar-btn" open-type="chooseAvatar" bindchooseavatar="onChooseAvatar">
      <image class="avatar-img" src="{{avatarUrl}}" mode="aspectFill" wx:if="{{avatarUrl}}"/>
      <van-icon name="plus" size="48rpx" color="#ccc" wx:else/>
    </button>
    <text class="avatar-hint">点击选择头像</text>
  </view>

  <view class="setup-nickname">
    <input class="nickname-input" type="nickname" placeholder="请输入昵称" value="{{nickName}}" bindinput="onNickInput"/>
  </view>

  <view class="setup-footer">
    <van-button type="primary" block round color="#FF5032" bindtap="onSubmit" disabled="{{!avatarUrl || !nickName}}">完成</van-button>
  </view>
</view>
```

- [ ] **Step 3: 创建 profile.wxss**

```css
.setup-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 40rpx 0;
  min-height: 100vh;
}

.setup-header { text-align: center; margin-bottom: 80rpx; }
.setup-title { font-size: 40rpx; font-weight: 600; color: #333; display: block; }
.setup-desc { font-size: 28rpx; color: #999; display: block; margin-top: 16rpx; }

.setup-avatar { display: flex; flex-direction: column; align-items: center; margin-bottom: 60rpx; }
.avatar-btn {
  width: 160rpx; height: 160rpx; border-radius: 50%;
  border: 2rpx dashed #ddd; background: #f9f9f9;
  display: flex; align-items: center; justify-content: center;
  padding: 0; margin: 0;
}
.avatar-img { width: 100%; height: 100%; border-radius: 50%; }
.avatar-hint { font-size: 24rpx; color: #bbb; margin-top: 20rpx; }

.setup-nickname { width: 100%; margin-bottom: 60rpx; }
.nickname-input {
  width: 100%; height: 80rpx; text-align: center;
  border-bottom: 2rpx solid #eee; font-size: 32rpx;
}

.setup-footer { width: 100%; position: fixed; bottom: 80rpx; left: 40rpx; right: 40rpx; width: calc(100% - 80rpx); }
```

- [ ] **Step 4: 创建 profile.js**

```js
const { call } = require('../../utils/cloud')
const app = getApp()

Page({
  data: {
    avatarUrl: '',
    nickName: ''
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  onNickInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  async onSubmit() {
    const { ok } = await call('user', {
      action: 'upsertProfile',
      nickName: this.data.nickName,
      avatarUrl: this.data.avatarUrl
    })
    if (ok) {
      app.clearProfileCache()
      wx.redirectTo({ url: '/pages/index/index' })
    }
  }
})
```

- [ ] **Step 5: 手测清单第 1 项**

在 WeChat DevTools 中打开此页面，选择头像、输入昵称、点击完成 → 跳转到首页（首页目前还是空壳）。

- [ ] **Step 6: 提交**

```bash
git add miniprogram/pages/setup/ && git commit -m "feat: setup profile page"
```

---

### Task 9: 首页 (pages/index/index)

**Files:**
- Create: `miniprogram/pages/index/index.js`
- Create: `miniprogram/pages/index/index.wxml`
- Create: `miniprogram/pages/index/index.wxss`

- [ ] **Step 1: 创建 index.wxml**

```xml
<view class="index-page">
  <!-- 头部欢迎 -->
  <view class="index-header">
    <text class="welcome">{{greeting}}</text>
    <text class="subtitle">{{statsSummary}}</text>
  </view>

  <!-- 操作按钮 -->
  <view class="index-actions">
    <view class="action-card" bindtap="onCreateRoom">
      <van-icon name="add-o" size="48rpx" color="#FF5032"/>
      <text class="action-title">创建房间</text>
      <text class="action-desc">开一个新房间，邀请朋友加入</text>
    </view>

    <view class="action-card" bindtap="onShowJoin">
      <van-icon name="friends-o" size="48rpx" color="#FF5032"/>
      <text class="action-title">加入房间</text>
      <text class="action-desc">输入好友分享的邀请码</text>
    </view>
  </view>

  <!-- 本月统计 -->
  <view class="stats-box" wx:if="{{stats}}">
    <view class="stats-item">
      <text class="stats-value">{{stats.totalGames}}</text>
      <text class="stats-label">本月局数</text>
    </view>
    <view class="stats-item">
      <text class="stats-value {{stats.netScore >= 0 ? 'positive' : 'negative'}}">{{stats.netScore >= 0 ? '+' : ''}}{{stats.netScore}}</text>
      <text class="stats-label">净输赢</text>
    </view>
  </view>

  <!-- 加入房间弹层 -->
  <van-popup show="{{showJoin}}" bind:close="onCloseJoin" custom-style="background:none">
    <view class="join-popup">
      <view class="join-title">输入邀请码</view>
      <input class="join-input" placeholder="6位邀请码" maxlength="6" value="{{code}}" bindinput="onCodeInput"/>
      <van-button type="primary" block round color="#FF5032" bindtap="onJoin" disabled="{{code.length !== 6}}">加入</van-button>
    </view>
    <view class="join-close" bindtap="onCloseJoin">
      <van-icon name="clear" color="#fff" size="48rpx"/>
    </view>
  </van-popup>
</view>
```

- [ ] **Step 2: 创建 index.wxss**

```css
.index-page {
  padding: 40rpx;
  min-height: 100vh;
  background: var(--color-bg);
}

.index-header { margin-bottom: 60rpx; }
.welcome { font-size: 44rpx; font-weight: 700; color: var(--color-text); display: block; }
.subtitle { font-size: 28rpx; color: var(--color-text-secondary); display: block; margin-top: 12rpx; }

.index-actions { display: flex; gap: 24rpx; margin-bottom: 40rpx; }
.action-card {
  flex: 1; background: var(--color-card); border-radius: 16rpx;
  padding: 40rpx 24rpx; text-align: center;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
}
.action-title { font-size: 32rpx; font-weight: 600; color: var(--color-text); display: block; margin-top: 16rpx; }
.action-desc { font-size: 24rpx; color: var(--color-text-secondary); display: block; margin-top: 8rpx; }

.stats-box {
  display: flex; background: linear-gradient(135deg, #FF5032, #ff7a66);
  border-radius: 16rpx; padding: 40rpx; color: #fff;
}
.stats-item { flex: 1; text-align: center; }
.stats-value { font-size: 48rpx; font-weight: 700; display: block; }
.stats-value.positive { color: #fff; }
.stats-value.negative { color: #ffd700; }
.stats-label { font-size: 24rpx; opacity: 0.85; display: block; margin-top: 8rpx; }

.join-popup {
  width: 520rpx; background: #fff; border-radius: 24rpx; padding: 60rpx 40rpx 40rpx;
}
.join-title { font-size: 32rpx; font-weight: 600; text-align: center; margin-bottom: 40rpx; }
.join-input {
  width: 100%; height: 80rpx; text-align: center;
  border: 2rpx solid #eee; border-radius: 12rpx; margin-bottom: 40rpx;
  font-size: 36rpx; letter-spacing: 12rpx; text-transform: uppercase;
}
.join-close { text-align: center; margin-top: 30rpx; }
```

- [ ] **Step 3: 创建 index.js**

```js
const { call } = require('../../utils/cloud')
const app = getApp()

Page({
  data: {
    greeting: '',
    statsSummary: '一起打牌，轻松记账',
    stats: null,
    showJoin: false,
    code: ''
  },

  async onShow() {
    // 检查 profile
    const profile = await app.getProfile()
    if (!profile) {
      wx.redirectTo({ url: '/pages/setup/profile' })
      return
    }
    const hours = new Date().getHours()
    const g = hours < 11 ? '早上好' : hours < 14 ? '中午好' : hours < 18 ? '下午好' : '晚上好'
    this.setData({ greeting: g + '，' + profile.nickName })

    // 检查是否在某进行中房间
    const db = wx.cloud.database()
    const myRooms = await db.collection('room_members')
      .where({ _openid: '{openid}', state: 1 }).get()
    if (myRooms.data.length) {
      const roomRes = await db.collection('rooms')
        .where({ _id: myRooms.data[0].roomId, state: 1 }).get()
      if (roomRes.data.length) {
        this.setData({ statsSummary: '你有一个进行中的房间' })
      }
    }
    // 加载本月简要统计（走 room_orders 聚合）
    await this._loadStats()
  },

  async _loadStats() {
    const db = wx.cloud.database()
    const _ = db.command
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

    try {
      const res = await db.collection('room_orders').where({
        createdAt: _.gte(monthStart)
      }).get()

      let netScore = 0
      const myOpenid = '{openid}'
      ;(res.data || []).forEach(o => {
        if (o.toOpenid === myOpenid) netScore += (o.amount || 0)
        if (o.fromOpenid === myOpenid) netScore -= (o.amount || 0)
      })

      this.setData({
        stats: {
          totalGames: 0, // 暂不计算局数（可后续 aggregate 优化）
          netScore
        }
      })
    } catch (e) {
      console.error('stats load error', e)
    }
  },

  async onCreateRoom() {
    const { ok, data } = await call('room', { action: 'create' })
    if (ok) {
      wx.navigateTo({ url: '/pages/room/detail?id=' + data.roomId })
    }
  },

  onShowJoin() { this.setData({ showJoin: true, code: '' }) },
  onCloseJoin() { this.setData({ showJoin: false }) },

  onCodeInput(e) {
    this.setData({ code: e.detail.value.toUpperCase() })
  },

  async onJoin() {
    const { ok, data } = await call('room', { action: 'join', code: this.data.code })
    if (ok) {
      this.setData({ showJoin: false })
      wx.navigateTo({ url: '/pages/room/detail?id=' + data.roomId })
    }
  }
})
```

- [ ] **Step 4: 手测清单第 2 项**

在 WeChat DevTools 中打开首页 → 看到欢迎语 → 点击"创建房间"。

- [ ] **Step 5: 提交**

```bash
git add miniprogram/pages/index/ && git commit -m "feat: index page with create/join"
```

---

### Task 10: 房间页 (pages/room/detail) · 核心页面

**Files:**
- Create: `miniprogram/pages/room/detail.js`
- Create: `miniprogram/pages/room/detail.wxml`
- Create: `miniprogram/pages/room/detail.wxss`
- Create: `miniprogram/pages/room/detail.json`

- [ ] **Step 1: 创建 room/detail.json**

```json
{
  "usingComponents": {
    "van-icon": "@vant/weapp/icon/index",
    "van-popup": "@vant/weapp/popup/index",
    "van-tag": "@vant/weapp/tag/index",
    "van-button": "@vant/weapp/button/index",
    "van-dialog": "@vant/weapp/dialog/index"
  }
}
```

- [ ] **Step 2: 创建 room/detail.wxml**

```xml
<view class="room-page">
  <!-- 成员横滚 -->
  <view class="users">
    <scroll-view class="users-scroll" scroll-x enable-flex>
      <view class="user-card" wx:for="{{visibleMembers}}" wx:key="userOpenid">
        <view class="user-avatar" style="background-image:url({{item.avatarUrl}})">
          <van-tag wx:if="{{info.ownerOpenid === item.userOpenid}}" class="owner-tag" type="primary" round color="#f2826a">房主</van-tag>
        </view>
        <view class="user-name">{{item.nickName}}</view>
        <view class="user-score {{aggregated[item.userOpenid] >= 0 ? 'positive' : 'negative'}}">
          {{aggregated[item.userOpenid] >= 0 ? '+' : ''}}{{aggregated[item.userOpenid] || 0}}
        </view>
      </view>

      <!-- 茶水虚拟卡片 -->
      <view class="user-card tea-card">
        <view class="user-avatar tea-avatar">
          <image src="../../images/tea.png" mode="widthFix" style="width:100%;height:100%"/>
        </view>
        <view class="user-name">茶水费</view>
        <view class="user-score positive">+{{teaTotal || 0}}</view>
      </view>

      <!-- 邀请按钮 -->
      <button class="user-card invite-card" open-type="share">
        <view class="user-avatar invite-avatar">
          <image src="../../images/invite.png" mode="widthFix" style="width:100%;height:100%"/>
        </view>
        <view class="user-name">邀请好友</view>
        <view class="user-score" style="font-size:24rpx;color:#999">点击分享</view>
      </button>
    </scroll-view>
  </view>

  <!-- 消息流 -->
  <scroll-view class="msg-scroll" scroll-y="{{true}}" scroll-into-view="{{lastMsgId}}">
    <view class="msg-item" wx:for="{{messages}}" wx:key="id" id="msg-{{item.id}}">
      <view class="msg-time">{{item.timeText}}</view>
      <view class="msg-text">{{item.text}}</view>
    </view>
    <van-empty wx:if="{{!messages.length}}" description="暂无记录" />
  </scroll-view>

  <!-- 底部操作栏 -->
  <view class="footer" wx:if="{{!readOnly && info.state === 1}}">
    <view class="footer-btn" bindtap="onShowScore">支出</view>
    <view class="footer-btn" bindtap="onLeave">退出</view>
    <view class="footer-btn" wx:if="{{info.ownerOpenid === myOpenid}}" bindtap="onCloseRoom">关闭房间</view>
  </view>

  <!-- 只读提示 -->
  <view class="footer readonly-hint" wx:if="{{readOnly || info.state === 2}}">
    <text>房间 {{info.state === 2 ? '已关闭' : '只读'}}</text>
  </view>

  <!-- 计分弹层 -->
  <van-popup show="{{showScorePopup}}" bind:close="onCloseScore" custom-style="background:none">
    <view class="score-popup">
      <view class="score-hint">填写你赢得的分数（给每个对手）</view>
      <view class="score-item" wx:for="{{visibleMembers}}" wx:key="userOpenid" wx:if="{{item.userOpenid !== myOpenid}}">
        <text class="score-name">{{item.nickName}}</text>
        <input class="score-input" type="number" placeholder="分数" value="{{scoreForm[item.userOpenid]}}" data-key="{{item.userOpenid}}" bindinput="onScoreInput"/>
      </view>
      <view class="score-item">
        <text class="score-name">茶水</text>
        <input class="score-input" type="number" placeholder="赢的一方操作" value="{{scoreForm._tea}}" data-key="_tea" bindinput="onScoreInput"/>
      </view>
      <van-button type="primary" block round color="#FF5032" bindtap="onSubmitScore">确定</van-button>
    </view>
    <view class="score-close" bindtap="onCloseScore">
      <van-icon name="clear" color="#fff" size="48rpx"/>
    </view>
  </van-popup>
</view>
```

- [ ] **Step 3: 创建 room/detail.wxss**

```css
.room-page {
  display: flex; flex-direction: column; height: 100vh;
  background: var(--color-bg);
}

.users { padding: 24rpx; flex-shrink: 0; }
.users-scroll { display: flex; white-space: nowrap; }

.user-card {
  display: inline-flex; flex-direction: column; align-items: center;
  width: 160rpx; flex-shrink: 0; margin-right: 16rpx;
}
.user-avatar {
  width: 100rpx; height: 100rpx; border-radius: 50%;
  background-size: cover; background-position: center;
  background-color: #eee; position: relative;
}
.owner-tag { position: absolute; right: -20rpx; top: -20rpx; }
.user-name { font-size: 26rpx; color: #333; margin-top: 8rpx; max-width: 140rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-score { font-size: 32rpx; font-weight: 600; margin-top: 4rpx; }
.user-score.positive { color: var(--color-primary); }
.user-score.negative { color: #52c41a; }

.tea-avatar { background: #f5f5dc; display: flex; align-items: center; justify-content: center; }
.invite-avatar { background: #f0f8ff; display: flex; align-items: center; justify-content: center; }
.invite-card::after { border: none; } /* 去掉 button 默认边框 */

.msg-scroll { flex: 1; padding: 20rpx 32rpx; overflow-y: auto; }
.msg-item { margin-bottom: 24rpx; }
.msg-time { font-size: 22rpx; color: #bbb; margin-bottom: 4rpx; }
.msg-text { font-size: 28rpx; color: #333; background: #fff; padding: 12rpx 20rpx; border-radius: 8rpx; display: inline-block; }

.footer {
  display: flex; justify-content: space-around; align-items: center;
  height: 100rpx; background: #fff; border-top: 1rpx solid #eee;
  flex-shrink: 0; padding-bottom: env(safe-area-inset-bottom);
}
.footer-btn { font-size: 28rpx; color: var(--color-primary); padding: 16rpx 32rpx; }
.readonly-hint { justify-content: center; font-size: 26rpx; color: #999; }

.score-popup {
  width: 580rpx; background: #fff; border-radius: 24rpx; padding: 48rpx 32rpx 32rpx;
}
.score-hint { font-size: 26rpx; color: #999; text-align: center; margin-bottom: 32rpx; }
.score-item { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24rpx; }
.score-name { font-size: 30rpx; color: #333; flex-shrink: 0; width: 100rpx; }
.score-input {
  flex: 1; height: 64rpx; border: 2rpx solid #eee; border-radius: 8rpx;
  padding: 0 16rpx; font-size: 28rpx; text-align: right;
}
.score-close { text-align: center; margin-top: 24rpx; }
```

- [ ] **Step 4: 创建 room/detail.js**

```js
const { call } = require('../../utils/cloud')
const { compute } = require('../../utils/aggregate')
const { formatTime } = require('../../utils/format')

Page({
  data: {
    id: '',
    readOnly: false,
    myOpenid: '',
    info: {},
    visibleMembers: [],
    orders: [],
    aggregated: {},
    teaTotal: 0,
    messages: [],
    showScorePopup: false,
    scoreForm: {},
    lastMsgId: ''
  },

  onLoad(options) {
    this.setData({ id: options.id, readOnly: options.readOnly === '1' })
  },

  onShow() {
    this._startWatchers()
  },

  onHide() {
    this._stopWatchers()
  },

  onUnload() {
    this._stopWatchers()
  },

  _startWatchers() {
    const db = wx.cloud.database()
    this._watchers = [
      db.collection('rooms').doc(this.data.id).watch({
        onChange: (snapshot) => {
          if (snapshot.docs && snapshot.docs.length) {
            this.setData({ info: snapshot.docs[0] })
          }
        },
        onError: (e) => console.error('rooms watch error', e)
      }),
      db.collection('room_members').where({ roomId: this.data.id }).watch({
        onChange: (snapshot) => {
          const members = snapshot.docs || []
          this.setData({ visibleMembers: members.filter(m => m.state === 1) })
          this._recalc()
        },
        onError: (e) => console.error('members watch error', e)
      }),
      db.collection('room_orders').where({ roomId: this.data.id }).orderBy('createdAt', 'asc').watch({
        onChange: (snapshot) => {
          const orders = snapshot.docs || []
          this.setData({ orders, lastMsgId: orders.length ? 'msg-' + orders[orders.length - 1]._id : '' })
          this._recalc()
        },
        onError: (e) => console.error('orders watch error', e)
      })
    ]
  },

  _stopWatchers() {
    if (this._watchers) {
      this._watchers.forEach(w => w.close())
      this._watchers = null
    }
  },

  _recalc() {
    const { visibleMembers, orders } = this.data
    if (!visibleMembers.length) return
    const result = compute(orders, visibleMembers)
    const messages = result.messages.map(m => ({
      ...m,
      timeText: formatTime(new Date(m.time))
    }))
    this.setData({
      aggregated: result.userScores,
      teaTotal: result.teaTotal,
      messages
    })
  },

  onShowScore() {
    this.setData({ showScorePopup: true, scoreForm: {} })
  },

  onCloseScore() {
    this.setData({ showScorePopup: false })
  },

  onScoreInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['scoreForm.' + key]: e.detail.value })
  },

  async onSubmitScore() {
    const form = this.data.scoreForm
    const entries = this.data.visibleMembers
      .filter(m => m.userOpenid !== this.data.myOpenid && form[m.userOpenid])
      .map(m => ({ toOpenid: m.userOpenid, amount: parseInt(form[m.userOpenid], 10) }))

    if (form._tea && parseInt(form._tea, 10) > 0) {
      entries.push({ toOpenid: '', amount: parseInt(form._tea, 10) })
    }

    if (!entries.length) {
      wx.showToast({ title: '请至少填写一项', icon: 'none' })
      return
    }

    const { ok } = await call('room', {
      action: 'score',
      roomId: this.data.id,
      entries
    })

    if (ok) {
      this.setData({ showScorePopup: false })
    }
  },

  async onLeave() {
    const res = await new Promise(r => {
      wx.showModal({
        title: '退出房间',
        content: '退出后你可以重新加入',
        success: r
      })
    })
    if (!res.confirm) return

    const { ok } = await call('room', { action: 'leave', roomId: this.data.id })
    if (ok) {
      wx.navigateBack()
    }
  },

  async onCloseRoom() {
    const res = await new Promise(r => {
      wx.showModal({
        title: '关闭房间',
        content: '关闭后所有人无法继续计分，确定吗？',
        success: r
      })
    })
    if (!res.confirm) return

    const { ok } = await call('room', { action: 'close', roomId: this.data.id })
    if (ok) {
      wx.showToast({ title: '房间已关闭', icon: 'none' })
    }
  },

  onShareAppMessage() {
    return {
      title: '邀请你加入打牌记账房间',
      path: '/pages/room/detail?id=' + this.data.id
    }
  }
})
```

- [ ] **Step 5: 手测清单第 3-6 项**

在 WeChat DevTools 中：建房 → 另一个账号加入 → 计分 → 实时变化 → 退出 → 人数减少 → 关闭房间（房主操作）。

- [ ] **Step 6: 提交**

```bash
git add miniprogram/pages/room/ && git commit -m "feat: room detail page with watch, score, leave, close"
```

---

### Task 11: 历史房间页 (pages/history/list)

**Files:**
- Create: `miniprogram/pages/history/list.js`
- Create: `miniprogram/pages/history/list.wxml`
- Create: `miniprogram/pages/history/list.wxss`
- Create: `miniprogram/pages/history/list.json`

- [ ] **Step 1: 创建 history/list.json**

```json
{
  "usingComponents": {
    "van-icon": "@vant/weapp/icon/index",
    "van-empty": "@vant/weapp/empty/index",
    "van-tag": "@vant/weapp/tag/index"
  }
}
```

- [ ] **Step 2: 创建 history/list.wxml**

```xml
<view class="history-page">
  <van-empty wx:if="{{!rooms.length && !loading}}" description="还没有参与过房间" />
  <view class="room-list" wx:if="{{rooms.length}}">
    <view class="room-item" wx:for="{{rooms}}" wx:key="_id" bindtap="onTapRoom" data-id="{{item._id}}" data-state="{{item.state}}">
      <view class="room-info">
        <text class="room-name">{{item.name}}</text>
        <text class="room-date">{{item.dateText}}</text>
      </view>
      <van-tag type="{{item.state === 1 ? 'primary' : 'default'}}" round color="{{item.state === 1 ? '#52c41a' : '#999'}}">
        {{item.state === 1 ? '进行中' : '已关闭'}}
      </van-tag>
    </view>
  </view>
</view>
```

- [ ] **Step 3: 创建 history/list.wxss**

```css
.history-page {
  padding: 24rpx;
  background: var(--color-bg);
  min-height: 100vh;
}

.room-item {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff; border-radius: 12rpx; padding: 32rpx 24rpx; margin-bottom: 16rpx;
}
.room-name { font-size: 30rpx; font-weight: 600; color: #333; display: block; }
.room-date { font-size: 24rpx; color: #999; display: block; margin-top: 6rpx; }
```

- [ ] **Step 4: 创建 history/list.js**

```js
const { formatTime } = require('../../utils/format')

Page({
  data: {
    rooms: [],
    loading: true
  },

  async onShow() {
    const db = wx.cloud.database()
    const me = await db.collection('room_members')
      .where({ _openid: '{openid}' })
      .orderBy('joinedAt', 'desc')
      .get()

    if (!me.data.length) {
      this.setData({ loading: false })
      return
    }

    const roomIds = [...new Set(me.data.map(m => m.roomId))]
    const _ = db.command
    const roomData = await db.collection('rooms')
      .where({ _id: _.in(roomIds) })
      .get()

    const rooms = roomData.data.map(r => ({
      ...r,
      dateText: r.createdAt ? formatTime(new Date(r.createdAt)) : ''
    }))

    this.setData({ rooms, loading: false })
  },

  onTapRoom(e) {
    const { id, state } = e.currentTarget.dataset
    const readOnly = state === 2 ? '1' : '0'
    wx.navigateTo({ url: '/pages/room/detail?id=' + id + '&readOnly=' + readOnly })
  }
})
```

- [ ] **Step 5: 手测清单第 7-8 项**

关房后进入历史页 → 看到该房间标识为"已关闭" → 点击进入只读视图。

- [ ] **Step 6: 提交**

```bash
git add miniprogram/pages/history/ && git commit -m "feat: history page with active/closed room list"
```

---

### Task 12: 云开发环境手动配置（数据库 Collection + 索引 + 权限）

这一步需要在 **微信云开发控制台** 手动操作（无 CLI 可执行，故记录详细步骤而非命令）。

- [ ] **Step 1: 创建 4 个 collection**

在云开发控制台 → 数据库 → 新建集合，分别创建：`profiles`、`rooms`、`room_members`、`room_orders`

- [ ] **Step 2: 配置权限**

对每个 collection → 权限设置：
- `profiles`：读 ="仅创建者可读"、写 ="仅云函数"
- `rooms`：读 ="所有用户可读"、写 ="仅云函数"
- `room_members`：读 ="所有用户可读"、写 ="仅云函数"
- `room_orders`：读 ="所有用户可读"、写 ="仅云函数"

- [ ] **Step 3: 创建索引**

| Collection | 索引字段 | 类型 |
|---|---|---|
| `profiles` | `_id` | 默认，无需额外 |
| `rooms` | `code` | 唯一索引 |
| `rooms` | `ownerOpenid` | 普通索引 |
| `room_members` | `roomId` | 普通索引 |
| `room_members` | `userOpenid` | 普通索引 |
| `room_orders` | `roomId` | 普通索引 |
| `room_orders` | `createdAt` | 普通索引（asc） |

- [ ] **Step 4: 上传云函数**

在 WeChat DevTools 中右键 `cloudfunctions/room` → 上传并部署；`cloudfunctions/user` 同理。

- [ ] **Step 5: 真机双账号完整流程手测**

按照设计文档第 7.2 节的 10 项手测清单，逐项在真机（或 DevTools 双账号预览）走一遍。

- [ ] **Step 6: 提交**

```bash
git add cloudfunctions/ && git commit -m "chore: final cloud function packages and manual setup notes"
```

---

### Task 13: 图标资源与 Vant 构建

- [ ] **Step 1: 复制参考项目图标**

```bash
cp -r reference-app/src/app/images miniprogram/images
```

然后手动补充缺少的 tabBar 图标：在 `miniprogram/images/tab/` 下放置 4 张 81x81 像素的 PNG 单色图标文件：
- `home.png`（灰色 #8a8a8a）、`home-active.png`（红色 #FF5032）
- `history.png`（灰色 #8a8a8a）、`history-active.png`（红色 #FF5032）

MVP 阶段可用纯色矩形代替，后续替换为设计图标。

- [ ] **Step 2: 安装 Vant Weapp**

```bash
cd miniprogram && npm init -y && npm install @vant/weapp
```

- [ ] **Step 3: 构建 npm**

在 WeChat DevTools → 工具 → 构建 npm。

- [ ] **Step 4: 提交**

```bash
git add miniprogram/images miniprogram/package.json miniprogram/package-lock.json && git commit -m "chore: images and vant weapp setup"
```

---

## 总览：任务依赖图

```
Task 0: git init + .gitignore
  └─ Task 1: 项目骨架（app.js/json/wxss/project.config）
       └─ Task 2: 前端工具模块（cloud.js/aggregate.js/format.js/error-messages.js）
            ├─ Task 3: room 云函数基础组件（code-generator + in-memory-db）
            │    ├─ Task 4: user 云函数 upsertProfile
            │    ├─ Task 5: room create + join
            │    │    ├─ Task 6: room score
            │    │    └─ Task 7: room leave + close
            │    └─ Task 8: 首次引导页（profile setup）
            │         └─ Task 9: 首页（index）
            │              ├─ Task 10: 房间页（room/detail）← 核心
            │              └─ Task 11: 历史页（history/list）
            └─ Task 12: 云开发环境手动配置
                 └─ Task 13: 图标 + Vant 构建
```

> **合并提交建议：**
> Process 顺序：0 → 1 → 2 → 3 → 4+5 并行 → 6+7+8 并行 → 9 → 10 → 11 → 12+13 并行。
> 数字仅代表推荐顺序，实际可以合并相关性高的 Task（如 4+5+8 在同一天做完）。

---

## 手测清单（引用设计文档 7.2）

1. 全新用户 → 引导页 → 设置头像昵称 → 进入首页
2. 用户 A 创建房间 → 拿到邀请码 → 用户 B 通过 code 加入
3. A 提交计分（含茶水）→ B 端实时看到消息流更新
4. B 退出房间 → A 看到人数变化
5. B 重新加入 → A 看到 B 回归
6. A（房主）退出 → 房主移交到 B
7. B（新的房主）关闭房间 → A 端状态变为只读
8. 历史页显示该房间 → 进入只读视图
9. 弱网下提交计分 → 错误提示符合预期
10. 退出房间页再回來 → watcher 重建，数据完整
