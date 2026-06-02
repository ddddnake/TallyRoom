# 微信打牌记账小程序设计文档

- **创建日期**：2026-05-14
- **状态**：草案
- **参考项目**：[gitee.com/luzbibibi/open-tayll-room-app](https://gitee.com/luzbibibi/open-tayll-room-app)（仅作 UI 与交互参考，不复用后端）
- **目标**：朋友间使用的轻量打牌记账小程序，体验版分发（≤100 人），后续视情况发布

---

## 1. 范围与目标

### 1.1 第一版功能范围

- 创建房间 / 通过邀请码加入
- 计分（付方 → 收方记分模型；含茶水费）
- 实时同步（`db.watch` 推送）
- 房间结算视图（成员净分、茶水合计、消息流）
- 退出房间 / 房主自动移交 / 主动关闭房间
- 历史房间列表（含已关闭的只读视图）
- 首次引导设置头像与昵称（每人仅一次）

### 1.2 明确不做

- 撤销 / 修改已提交的计分（不可撤销）
- 全局用户中心、登录方式切换、账号绑定
- 自定义 tabBar 凸起按钮（用原生 tabBar）
- 广告位、订阅消息、激励视频
- 离线队列、乐观更新
- 多语言、深色模式
- 多端（仅微信小程序）

### 1.3 成功标准

- 朋友（3-6 人）能在一局牌局中无障碍记分；计分提交到所有成员看到 < 1 秒
- 历史房间数据稳定可查
- 房主退出 / 关闭等边界场景不出现"幽灵房间"

---

## 2. 整体架构

```
[微信小程序前端]
   │
   │   读：db.watch（实时订阅）
   │   ├─ rooms（房间状态）
   │   ├─ room_members（成员）
   │   └─ room_orders（计分流水）
   │
   │   写：wx.cloud.callFunction
   │   ├─ room（按 action 分发：create/join/score/leave/close）
   │   └─ user（upsertProfile）
   │
   │   登录：wx.cloud 自动注入 openid，无需自建登录
   │
[微信云开发]
   ├─ Database：4 个 collection
   ├─ Cloud Functions：room + user
   └─ Storage：暂不使用
```

**架构决策（方案 C：混合）**：
- 读：前端 `db.watch` 直接订阅
- 写：所有改数据动作走云函数，集中校验、原子事务、并发安全
- 不要全局 `users` 表，`openid` 即用户主键

---

## 3. 数据模型

### 3.1 `profiles` —— 全局用户档案

```js
{
  _id: openid,            // 用 openid 当主键
  _openid: openid,        // 云开发自动写入
  nickName: "老王",
  avatarUrl: "...",
  createdAt: serverDate,
  updatedAt: serverDate
}
```

### 3.2 `rooms` —— 房间主表

```js
{
  _id: auto,
  _openid: openid,        // 创建时云开发自动写入（房主）
  code: "AB3X9K",         // 6 位大写字母数字邀请码
  name: "周末小聚",        // 默认 "{昵称}的房间"
  state: 1,               // 1 进行中, 2 已关闭
  ownerOpenid: openid,    // 显式房主字段（移交后会变）
  memberCount: 3,         // 当前在场人数（缓存）
  createdAt: serverDate,
  closedAt: null
}
```

### 3.3 `room_members` —— 房间成员

```js
{
  _id: auto,
  roomId: "...",
  userOpenid: openid,
  nickName: "老王",        // 加入时刻的快照
  avatarUrl: "...",
  state: 1,               // 1 在场, 2 已退出
  joinedAt: serverDate,
  leftAt: null
}
```

### 3.4 `room_orders` —— 计分流水（不可变）

```js
{
  _id: auto,
  roomId: "...",
  fromOpenid: openid,
  toOpenid: openid | "",  // "" 表示茶水
  amount: 50,             // 正整数（"分"）
  fromNickSnap: "老王",
  toNickSnap: "小红",      // toOpenid="" 时为空字符串
  createdAt: serverDate
}
```

### 3.5 索引

| Collection | 索引 |
|---|---|
| `profiles` | `_id` 默认 |
| `rooms` | `code` 唯一、`ownerOpenid + state` |
| `room_members` | `roomId + userOpenid` 唯一、`userOpenid + state` |
| `room_orders` | `roomId + createdAt` |

### 3.6 数据库权限

| Collection | 读 | 写 |
|---|---|---|
| `profiles` | 仅创建者 | 仅云函数 |
| `rooms` | 所有用户 | 仅云函数 |
| `room_members` | 所有用户 | 仅云函数 |
| `room_orders` | 所有用户 | 仅云函数 |

> "所有用户可读"是云开发实时共享数据的常规做法；准入控制由邀请码 + `join` 云函数把守。

### 3.7 关键设计点

- **昵称/头像快照**：`room_members` 与 `room_orders` 中的昵称头像是加入/提交时刻的快照，全局 `profiles` 后续修改不会回写历史。
- **金额用整数**：避免浮点精度问题，单位为"分"（也对应"分数"语义）。
- **不存最终金额**：`room_members` 不存净分；前端按 `room_orders` 实时聚合。
- **取消 logs 表**：原项目用 `tally_room_logs` 存消息流，新方案直接用 `room_orders` 渲染消息流。

---

## 4. 云函数 API

### 4.1 通用约定

所有云函数返回：

```js
{ ok: true, data: ... }
// 或
{ ok: false, code: "ERROR_CODE", message: "中文描述" }
```

错误码（最小集）：

- `NO_PROFILE` —— 未设置昵称头像
- `ROOM_NOT_FOUND` / `ROOM_CLOSED`
- `NOT_MEMBER` / `NOT_OWNER`
- `INVALID_AMOUNT` / `INVALID_TARGET`
- `CODE_GENERATION_FAILED`（极小概率）

网络/超时异常由前端 `utils/cloud.js` 统一兜底为"网络异常，请重试"。

### 4.2 云函数 `room`

按 `event.action` 分发到 `handlers.js` 中的纯函数。

#### `action: "create"`

入参：`{ name?: string }`
逻辑：
1. 查 `profiles[openid]`，无则返回 `NO_PROFILE`
2. 生成 6 位大写字母数字邀请码（`A-Z`+`0-9`，避开易混字符 `O/0/I/1`），失败重试 5 次
3. 事务：写 `rooms` + 写 `room_members`（房主自动加入）
4. 返回 `{ roomId, code }`

#### `action: "join"`

入参：`{ code: string }`
逻辑：
1. 按 `code` 查 `rooms`；找不到 → `ROOM_NOT_FOUND`；`state=2` → `ROOM_CLOSED`
2. 查 `room_members`：
   - 已有且 `state=1` → 返回 `roomId`（幂等）
   - 已有且 `state=2` → 复用记录：`state=1`、清除 `leftAt`、`memberCount += 1`、刷新 `nickName/avatarUrl` 快照为当前 profile
   - 不存在 → 新建 `room_members` + `memberCount += 1`
3. 返回 `{ roomId }`

#### `action: "score"`

入参：

```js
{
  roomId,
  entries: [
    { toOpenid: "openid_a", amount: 50 },
    { toOpenid: "openid_b", amount: 30 },
    { toOpenid: "",         amount: 10 }   // 茶水
  ]
}
```

逻辑：
1. 校验当前用户是该房 `state=1` 成员，否则 `NOT_MEMBER`
2. 校验房间 `state=1`，否则 `ROOM_CLOSED`
3. 校验 `entries`：
   - `amount` 必须正整数
   - `toOpenid` 若非空必须是该房 `state=1` 成员
   - 不能给自己记分（`toOpenid !== openid`）
   - 不满足任一 → `INVALID_AMOUNT` / `INVALID_TARGET`
4. 事务：批量写多条 `room_orders`，每条带 `fromNickSnap` / `toNickSnap`
5. 返回 `{ count: N }`

#### `action: "leave"`

入参：`{ roomId }`
逻辑：
1. 校验当前用户是该房 `state=1` 成员，否则 `NOT_MEMBER`
2. 若是房主：在 `room_members` 中找最早加入的、`state=1` 且非自己的成员转交 `ownerOpenid`；若无人 → 自动 `rooms.state=2, closedAt=now`
3. 事务：自己 `state=2 + leftAt`、`memberCount -= 1`、可能的房主转移、可能的房间关闭
4. 返回 `{ ok: true }`

#### `action: "close"`

入参：`{ roomId }`
逻辑：
1. 校验当前用户是房主，否则 `NOT_OWNER`
2. 房间 `state=1`，否则 `ROOM_CLOSED`
3. `rooms.state=2, closedAt=now`
4. 不动 `room_members`（保留快照供历史只读）
5. 返回 `{ ok: true }`

### 4.3 云函数 `user`

#### `action: "upsertProfile"`

入参：`{ nickName: string, avatarUrl: string }`
逻辑：
1. 校验：`nickName` 长度 1-20、`avatarUrl` 长度 ≤ 500
2. `profiles.doc(openid).set({ nickName, avatarUrl, updatedAt })`，首次额外写 `createdAt`
3. **不**回写 `room_members`（保留快照）
4. 返回 `{ ok: true }`

---

## 5. 前端结构

### 5.1 页面

| 路径 | 说明 |
|---|---|
| `pages/setup/profile` | 首次引导：选头像（`open-type="chooseAvatar"`）+ 输入昵称（`type="nickname"`） |
| `pages/index/index` | 首页：欢迎语 + 个人本月统计 + 创建/加入入口 + 历史入口 |
| `pages/room/detail` | 房间页：成员横滚 / 消息流 / 计分弹层 / 退出·关闭 |
| `pages/history/list` | 历史房间列表（进行中可入、已关闭只读） |

历史房间页通过传 `readOnly=1` 复用 `pages/room/detail`，只读模式下隐藏底部操作栏。

### 5.2 工具模块

- `utils/cloud.js` —— 包装 `wx.cloud.callFunction`，统一拆 `{ok, code, message, data}`，错误统一 toast
- `utils/aggregate.js` —— 前端聚合纯函数：input(orders, members) → output(每人净分、茶水合计、消息流文案)
- `utils/error-messages.js` —— 错误码 → 中文文案表
- `utils/format.js` —— 时间 / 金额格式化（保留原项目逻辑）

### 5.3 实时同步

进入房间页启动 3 个 watcher：

```js
const db = wx.cloud.database()
this.watchers = [
  db.collection('rooms').doc(id).watch({...}),
  db.collection('room_members').where({roomId: id}).watch({...}),
  db.collection('room_orders').where({roomId: id})
    .orderBy('createdAt', 'asc').watch({...})
]
```

工程要点：
1. 首次回调返回全量 snapshot（`type:'init'`），之后只带 diff，按 `_id` 合并到本地状态，不要全量 setData
2. `onUnload` 关闭所有 watcher，避免泄漏（云开发单客户端 watch 上限 5）
3. `onShow` 强制重建 watcher，兜底后台回收 / 弱网情况
4. order 不可变，按 `_id` 去重

第一版**不做**：乐观更新、离线队列、人数上限。

### 5.4 路由约定

- `pages/index/index` 不自动跳"我正在的房间"，由用户主动从首页或历史页进入
- 邀请分享路径：`pages/room/detail?id=${roomId}&code=${code}`，`onLoad` 检测到 `code` 时自动调 `room.join`

### 5.5 自定义 tabBar

第一版不做，使用原生 tabBar：首页 / 历史。

---

## 6. 错误处理与边界

### 6.1 前端

- 所有云函数调用走 `utils/cloud.js`：
  - `ok:true` → 返回 `data`
  - `ok:false` → 按 `code` 取中文文案 toast
  - 网络异常 → "网络异常，请重试"
- 不做自动重试（防止重复计分）

### 6.2 关键边界场景行为

| 场景 | 行为 |
|---|---|
| 房主退出且无其他在场成员 | 房间自动 `state=2`，房主 `state=2` |
| 房主关闭房间后某成员仍在房间页 | watch 推送 `rooms.state=2`，UI 切换为只读，隐藏操作栏 |
| 用户重复点击"提交计分" | 不去重，依赖用户操作；写入即生效不可撤销 |
| 加入已关闭的房间 | 返回 `ROOM_CLOSED`，前端 toast |
| 进入只读历史房间 | watcher 仍然可读；底部操作栏隐藏 |

---

## 7. 测试策略

### 7.1 云函数自动化测试（Jest）

- 把每个 action 抽成 `handlers.js` 中的纯函数：`(event, openid, db) => result`
- mock 数据库实现最小子集：`collection().doc()/where()/get()/update()/add()/runTransaction()/aggregate()`
- 测试用例覆盖：
  - 每个 action 的 happy path
  - 关键校验失败：`NO_PROFILE`、`ROOM_CLOSED`、`NOT_MEMBER`、`NOT_OWNER`、`INVALID_AMOUNT`、`INVALID_TARGET`
  - 边界：房主退出无人 → 自动关房；重新加入 → 复用记录刷新快照；给自己记分 → 拒绝
- 跑命令：`cd cloudfunctions/room && npm test`

### 7.2 前端手测清单（每次发布前过一遍）

1. 全新用户首次进入 → 引导页 → 设置头像昵称 → 进入首页
2. 用户 A 创建房间 → 拿到邀请码 → 用户 B 通过 code 加入
3. A 提交一组计分（含茶水）→ B 端 < 1 秒看到消息流更新与净分变化
4. B 退出房间 → A 端看到人数变化、B 不在成员列表
5. B 重新通过 code 加入 → A 端看到 B 回归（昵称为最新 profile）
6. A 退出（房主移交）→ B 自动成为房主，A 端跳回首页
7. A（已是房主）"关闭房间" → B 房间页变只读
8. 历史房间页能看到刚才的房间，进入是只读视图
9. 弱网下提交计分 → 等待 / 错误提示符合预期
10. 退出房间页再回来 → watcher 重建，数据完整

---

## 8. 项目结构

```
TallyRoom/
├── docs/superpowers/specs/
│   └── 2026-05-14-wechat-tallyroom-design.md
├── reference-app/                   # 参考项目（已 clone 解压，仅作 UI 视觉参考）
├── miniprogram/
│   ├── pages/
│   │   ├── setup/profile/
│   │   ├── index/
│   │   ├── room/detail/
│   │   └── history/list/
│   ├── utils/
│   │   ├── cloud.js
│   │   ├── aggregate.js
│   │   ├── error-messages.js
│   │   └── format.js
│   ├── images/
│   ├── app.js
│   ├── app.json
│   ├── app.wxss
│   └── sitemap.json
├── cloudfunctions/
│   ├── room/
│   │   ├── index.js
│   │   ├── handlers.js
│   │   ├── handlers.test.js
│   │   ├── lib/
│   │   │   ├── codes.js
│   │   │   └── code-generator.js
│   │   ├── package.json
│   │   └── README.md
│   └── user/
│       ├── index.js
│       ├── handlers.js
│       ├── handlers.test.js
│       └── package.json
├── project.config.json
└── README.md
```

`reference-app/` 不被任何代码 import，仅作设计期参考；将来可移出仓库。

---

## 9. 环境准备

实施前必须完成：

- [ ] 注册 / 选定小程序 AppID（个人号即可，免备案）
- [ ] 安装最新稳定版微信开发者工具
- [ ] 在该 AppID 下开通云开发，创建 1 个云环境（建议命名如 `tally-prod`），记录 envId
- [ ] Node.js 16+（云函数 Node 16 运行时） + npm
- [ ] `project.config.json` 关联 AppID + 云环境 ID
- [ ] 在云开发控制台手动创建 4 个 collection 并配置权限（参见 3.6）
- [ ] 在云开发控制台为 `rooms.code`、`room_members.{roomId,userOpenid}` 等字段创建索引（参见 3.5）

---

## 10. 工期估算

按业余时间（晚上 + 周末）节奏：

| 阶段 | 内容 | 估时 |
|---|---|---|
| 环境与基础 | AppID/云环境/collection/权限/索引/项目骨架 | 1 天 |
| 引导 + 首页 | profile 设置、首页空壳 | 1 天 |
| 云函数 `room.create/join` + 房间页骨架 | 含 watch 接入 | 2 天 |
| 云函数 `room.score` + 计分弹层 + 消息流 | 核心体验 | 2 天 |
| `room.leave/close` + 房主移交 | 退出与关闭 | 1 天 |
| 历史房间页 + 只读视图 | | 1 天 |
| Jest 单测补齐 | | 1 天 |
| 真机调试 + 抛光 | | 2 天 |

**合计约 11 个工作日 ≈ 业余 2-3 周**。

---

## 11. 不在本设计内的问题

后续单独立项：

- 撤销 / 修改计分（业务规则更复杂，需要交易流水补偿）
- 多端（H5、APP）
- 公开发布与小程序审核
- 数据导出（CSV / 图片账单）
- 订阅消息（开局提醒、关房通知）
- 自定义 tabBar 与品牌化视觉重做
