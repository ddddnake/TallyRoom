const { call } = require('../../utils/cloud')
const { compute } = require('../../utils/aggregate')
const { settle } = require('../../utils/settlement')
const { formatTime } = require('../../utils/format')
const app = getApp()

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
    groups: [],
    showQuickScore: false,
    quickTargetOpenid: '',
    quickTargetName: '',
    quickAmount: '',
    quickFocus: false,
    lastMsgId: '',
    showProfileEditor: false,
    editAvatarDisplay: '',
    editAvatarLocal: '',
    editNickName: '',
    showInvite: false,
    inviteQrUrl: '',
    inviteQrError: '',
    showSettlement: false,
    settleData: { summary: [], transfers: [], teaTotal: 0, teaShare: 0, teaShareDisplay: '0', memberCount: 0 },
    roomReady: false  // 房间核心数据（info + 成员）已就绪，false 时统一显示 loading 占位避免上下半部分错位渲染
  },

  onLoad(options) {
    // 从小程序码进入：options.scene = 邀请码（如 "AB3X9K"）
    // 从分享卡进入：options.id = 房间 id, options.code = 邀请码
    const scene = options.scene ? decodeURIComponent(options.scene) : ''
    this.setData({
      id: options.id || '',
      readOnly: options.readOnly === '1',
      pendingJoinCode: scene || options.code || '',
      needsJoin: !!(scene || options.code || options.fromShare)
    })
  },

  // 跳到资料设置页，把当前 pending 房间/code 存进 storage 以便回跳
  _redirectToSetup() {
    if (this.data.id) wx.setStorageSync('pending_share_room', this.data.id)
    if (this.data.pendingJoinCode) wx.setStorageSync('pending_share_code', this.data.pendingJoinCode)
    wx.redirectTo({ url: '/pages/setup/profile' })
  },

  async onShow() {
    // 进入时一律先显示 loading 占位，等 watcher 把核心数据补回来再切换到主内容
    this.setData({ roomReady: false })
    // 拿当前用户 profile（顺便取 openid）
    const profile = await app.getProfile()
    console.log('[room.onShow] profile:', profile, 'needsJoin:', this.data.needsJoin, 'id:', this.data.id, 'pendingJoinCode:', this.data.pendingJoinCode)
    if (!profile) {
      this._redirectToSetup()
      return
    }
    const myOpenid = profile._openid || profile._id
    if (myOpenid) this.setData({ myOpenid })

    // sweep 改成 fire-and-forget：清理类任务不应阻塞用户看到数据
    if (this.data.id) {
      call('room', { action: 'sweep', roomId: this.data.id }, { silent: true }).catch(() => {})
    }

    // 扫小程序码进入：只有邀请码没有 roomId，先 join 拿到 roomId
    if (!this.data.id && this.data.pendingJoinCode) {
      const { ok, data, code: errCode } = await call('room', { action: 'join', code: this.data.pendingJoinCode }, { silent: true })
      if (!ok && errCode === 'NO_PROFILE') {
        app.clearProfileCache()
        this._redirectToSetup()
        return
      }
      if (!ok || !data || !data.roomId) {
        wx.switchTab({ url: '/pages/index/index' })
        return
      }
      this.setData({ id: data.roomId })
      this._joined = true
    }

    // 没有 roomId 且没有 join code：异常，回首页
    if (!this.data.id) {
      wx.switchTab({ url: '/pages/index/index' })
      return
    }

    // 立刻启动 watchers——这一步会让数据"边到边渲"，用户立即能看到房间内容
    // 成员检查/join 与 watch 并行进行，watch 一拿到推送就刷新 UI
    this._startWatchers()

    // 检查当前用户是否已是房间成员；不是则尝试加入（在后台并行进行，不阻塞 UI）
    if (!this._joined && !this.data.readOnly) {
      this._ensureMembership(myOpenid).catch(e => console.error('ensure membership failed', e))
    }
  },

  // 后台确认当前用户是否房间成员；不是则尝试加入。失败时根据原因兜底跳转
  async _ensureMembership(myOpenid) {
    const db = wx.cloud.database()
    const memRes = await db.collection('room_members')
      .where({ roomId: this.data.id, userOpenid: myOpenid, state: 1 })
      .limit(1).get()

    console.log('[room.onShow] my membership check:', memRes.data.length, 'records for', myOpenid)

    if (memRes.data.length) {
      this._joined = true
      return
    }

    // 不是成员 → 查房间 code 然后 join
    const roomRes = await db.collection('rooms').doc(this.data.id).get().catch(e => {
      console.error('[room.onShow] get room failed:', e)
      return null
    })
    const room = roomRes && (Array.isArray(roomRes.data) ? roomRes.data[0] : roomRes.data)
    console.log('[room.onShow] fetched room:', room)
    if (!room) {
      wx.showToast({ title: '房间不存在', icon: 'none' })
      wx.switchTab({ url: '/pages/index/index' })
      return
    }
    if (room.state === 2) {
      this.setData({ readOnly: true })
      this._joined = true
      return
    }
    console.log('[room.onShow] auto-joining with code:', room.code)
    const { ok, data, code: errCode } = await call('room', { action: 'join', code: room.code }, { silent: true })
    console.log('[room.onShow] join result:', { ok, data, errCode })
    if (!ok && errCode === 'NO_PROFILE') {
      app.clearProfileCache()
      this._redirectToSetup()
      return
    }
    if (!ok) {
      wx.switchTab({ url: '/pages/index/index' })
      return
    }
    if (data && data.roomId && data.roomId !== this.data.id) {
      this.setData({ id: data.roomId })
    }
    this._joined = true
  },

  onHide() {
    this._stopWatchers()
  },

  onUnload() {
    this._stopWatchers()
  },

  _startWatchers() {
    const db = wx.cloud.database()
    // 标记关键数据是否已到达：info（房间元数据）和 members（至少一次推送）
    this._gotInfo = false
    this._gotMembers = false
    const tryMarkReady = () => {
      if (this._gotInfo && this._gotMembers && !this.data.roomReady) {
        this.setData({ roomReady: true })
      }
    }
    // 超时兜底：3 秒内若 watch 还没把数据补齐，也强制揭幕，让用户至少看到当前页面
    if (this._readyTimeoutId) clearTimeout(this._readyTimeoutId)
    this._readyTimeoutId = setTimeout(() => {
      if (!this.data.roomReady) {
        console.warn('[room] watch slow, force reveal')
        this.setData({ roomReady: true })
      }
    }, 3000)

    // 主动拉一次初始数据，与 watch 并行——不依赖 watch 的初始推送时机
    this._fetchInitialData()

    this._watchers = [
      db.collection('rooms').doc(this.data.id).watch({
        onChange: (snapshot) => {
          if (snapshot.docs && snapshot.docs.length) {
            this.setData({ info: snapshot.docs[0] })
            this._gotInfo = true
            tryMarkReady()
          }
        },
        onError: (e) => console.error('rooms watch error', e)
      }),
      db.collection('room_members').where({ roomId: this.data.id }).watch({
        onChange: async (snapshot) => {
          const members = snapshot.docs || []
          console.log('[watch members] type:', snapshot.type, 'count:', members.length,
                      'openids:', members.map(m => m.userOpenid + '(' + m.state + ')').join(','))
          await this._applyMembers(members)
          this._gotMembers = true
          tryMarkReady()
        },
        onError: (e) => console.error('members watch error', e)
      }),
      db.collection('room_orders').where({ roomId: this.data.id }).orderBy('createdAt', 'asc').watch({
        onChange: (snapshot) => {
          const orders = snapshot.docs || []
          // watch 拿到真实记录后，剔除已落库的 pending（按 from→to→amount 匹配最早一条）
          if (this._pendingOrders && this._pendingOrders.length) {
            const remaining = []
            const consumed = new Set()
            this._pendingOrders.forEach(p => {
              const matchIdx = orders.findIndex((o, i) => !consumed.has(i)
                && o.fromOpenid === p.fromOpenid
                && (o.toOpenid || '') === (p.toOpenid || '')
                && o.amount === p.amount
                && Math.abs((o.createdAt || 0) - p.createdAt) < 60000)
              if (matchIdx >= 0) consumed.add(matchIdx)
              else remaining.push(p)
            })
            this._pendingOrders = remaining
          }
          this.setData({ orders, lastMsgId: '' })
          this._recalc()
        },
        onError: (e) => console.error('orders watch error', e)
      })
    ]
  },

  // 主动一次性拉房间元数据 + 成员，作为 watch 推送的兜底
  async _fetchInitialData() {
    const db = wx.cloud.database()
    try {
      const [roomRes, memRes] = await Promise.all([
        db.collection('rooms').doc(this.data.id).get().catch(() => null),
        db.collection('room_members').where({ roomId: this.data.id }).get().catch(() => null)
      ])
      const info = roomRes && (Array.isArray(roomRes.data) ? roomRes.data[0] : roomRes.data)
      if (info && !this._gotInfo) {
        this.setData({ info })
        this._gotInfo = true
      }
      const members = memRes && memRes.data
      if (members && !this._gotMembers) {
        await this._applyMembers(members)
        this._gotMembers = true
      }
      if (this._gotInfo && this._gotMembers && !this.data.roomReady) {
        this.setData({ roomReady: true })
      }
    } catch (e) {
      console.error('[room] _fetchInitialData failed:', e)
    }
  },

  // 把成员原始数组处理（去重、排序、解析头像）后写入 setData
  async _applyMembers(members) {
    const byOpenid = {}
    members.forEach(m => {
      const prev = byOpenid[m.userOpenid]
      if (!prev || (m.joinedAt || 0) >= (prev.joinedAt || 0)) {
        byOpenid[m.userOpenid] = m
      }
    })
    const unique = Object.values(byOpenid)
    unique.forEach(m => { m.leftFlag = m.state !== 1 })
    unique.sort((a, b) => {
      if (a.leftFlag !== b.leftFlag) return a.leftFlag ? 1 : -1
      return (a.joinedAt || 0) - (b.joinedAt || 0)
    })
    await this._resolveAvatars(unique)
    const activeMemberCount = unique.filter(m => !m.leftFlag).length
    this.setData({ visibleMembers: unique, activeMemberCount })
    this._recalc()
  },

  _stopWatchers() {
    if (this._watchers) {
      this._watchers.forEach(w => w.close())
      this._watchers = null
    }
    if (this._readyTimeoutId) {
      clearTimeout(this._readyTimeoutId)
      this._readyTimeoutId = null
    }
    this._gotInfo = false
    this._gotMembers = false
  },

  // 把成员数组里 cloud:// 开头的头像 URL 批量转换为 https 临时 URL
  // 返回 true 表示有 URL 被替换（调用方可以决定是否再 setData 一次）
  async _resolveAvatars(members) {
    // 用 app 级缓存：跨房间/跨页面复用，进出房间不会重复解析同一个头像
    if (!app._avatarUrlCache) app._avatarUrlCache = {}
    const cache = app._avatarUrlCache
    const toResolve = []
    members.forEach(m => {
      if (m.avatarUrl && m.avatarUrl.startsWith('cloud://')) {
        if (cache[m.avatarUrl]) {
          m.avatarUrl = cache[m.avatarUrl]
        } else {
          toResolve.push(m.avatarUrl)
        }
      }
    })
    if (!toResolve.length) return false
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: toResolve })
      const map = {}
      ;(res.fileList || []).forEach(item => {
        if (item.tempFileURL) {
          map[item.fileID] = item.tempFileURL
          cache[item.fileID] = item.tempFileURL
        }
      })
      let changed = false
      members.forEach(m => {
        if (map[m.avatarUrl]) {
          m.avatarUrl = map[m.avatarUrl]
          changed = true
        }
      })
      return changed
    } catch (e) {
      console.error('getTempFileURL failed:', e)
      return false
    }
  },

  _recalc() {
    const { visibleMembers, orders } = this.data
    if (!visibleMembers.length) return
    // 清理超过 30 秒还没对账上的 pending：防止时钟偏差或匹配异常导致 pending 永久残留虚高分数
    const now = Date.now()
    this._pendingOrders = (this._pendingOrders || []).filter(p => now - p.createdAt < 30000)
    const pending = this._pendingOrders
    // 合并真实订单 + 乐观更新中的 pending 订单（按 createdAt 排序）
    const merged = pending.length
      ? orders.concat(pending).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      : orders
    const result = compute(merged, visibleMembers)
    // 缓存最新的 summary，结算时直接复用而不必再次拉取并计算
    this._lastComputed = {
      teaTotal: result.teaTotal,
      teaShare: result.teaShare,
      teaShareDisplay: result.teaShareDisplay,
      memberCount: result.memberCount,
      summary: result.summary
    }
    const enriched = result.messages.map(m => ({
      ...m,
      timeText: formatTime(new Date(m.time))
    }))
    const GROUP_GAP_MS = 2 * 60 * 1000
    const groups = []
    let cur = null
    enriched.forEach(m => {
      if (!cur || m.time - cur.endTime > GROUP_GAP_MS) {
        cur = { startTime: m.time, endTime: m.time, messages: [m] }
        groups.push(cur)
      } else {
        cur.messages.push(m)
        cur.endTime = m.time
      }
    })
    const pad = v => (v < 10 ? '0' + v : '' + v)
    const hm = ms => {
      const d = new Date(ms)
      return pad(d.getHours()) + ':' + pad(d.getMinutes())
    }
    groups.forEach(g => {
      g.id = 'g_' + g.startTime
      g.label = g.messages.length === 1
        ? hm(g.startTime)
        : hm(g.startTime) + ' - ' + hm(g.endTime)
      g.count = g.messages.length
      g.messages.reverse()
    })
    groups.reverse()
    this.setData({
      aggregated: result.userScores,
      teaTotal: result.teaTotal,
      groups
    })
  },

  // 点击成员头像：自己 → 资料编辑；他人 → 记分（已退出不可记分）
  onTapMember(e) {
    const { openid, name, left } = e.currentTarget.dataset
    if (openid === this.data.myOpenid) {
      this._openProfileEditor()
      return
    }
    if (left) {
      wx.showToast({ title: '该成员已退出', icon: 'none' })
      return
    }
    if (this.data.readOnly || this.data.info.state !== 1) return
    this.setData({
      showQuickScore: true,
      quickTargetOpenid: openid,
      quickTargetName: '记给 ' + name,
      quickAmount: '',
      quickFocus: false
    })
    setTimeout(() => this.setData({ quickFocus: true }), 50)
  },

  async _openProfileEditor() {
    const profile = await app.getProfile()
    if (!profile) return
    // 把已是 https 的临时 URL 留作展示，新选才会替换
    let displayAvatar = profile.avatarUrl
    if (displayAvatar && displayAvatar.startsWith('cloud://')) {
      const cache = app._avatarUrlCache || (app._avatarUrlCache = {})
      if (cache[displayAvatar]) {
        displayAvatar = cache[displayAvatar]
      } else {
        try {
          const res = await wx.cloud.getTempFileURL({ fileList: [displayAvatar] })
          if (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) {
            cache[profile.avatarUrl] = res.fileList[0].tempFileURL
            displayAvatar = res.fileList[0].tempFileURL
          }
        } catch (e) { /* ignore */ }
      }
    }
    this.setData({
      showProfileEditor: true,
      editAvatarDisplay: displayAvatar,
      editAvatarLocal: '',
      editNickName: profile.nickName || ''
    })
  },

  onCloseProfileEditor() {
    this.setData({ showProfileEditor: false })
  },

  onEditChooseAvatar(e) {
    this.setData({
      editAvatarLocal: e.detail.avatarUrl,
      editAvatarDisplay: e.detail.avatarUrl
    })
  },

  onEditNickInput(e) {
    this.setData({ editNickName: e.detail.value })
  },

  async onSaveProfile() {
    const nickName = (this.data.editNickName || '').trim()
    if (!nickName) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    if (this._savingProfile) return
    this._savingProfile = true
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      const profile = await app.getProfile()
      let finalUrl = profile.avatarUrl

      // 用户选了新头像 → 上传到云存储
      if (this.data.editAvatarLocal) {
        const local = this.data.editAvatarLocal
        const ext = (local.match(/\.(\w+)(\?|$)/) || [])[1] || 'jpg'
        const cloudPath = 'avatars/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: local })
        finalUrl = uploadRes.fileID
      }

      const { ok } = await call('user', {
        action: 'upsertProfile',
        nickName,
        avatarUrl: finalUrl
      })
      if (ok) {
        app.clearProfileCache()
        this.setData({ showProfileEditor: false })
        wx.showToast({ title: '已保存', icon: 'success' })
      }
    } catch (e) {
      console.error('save profile failed', e)
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this._savingProfile = false
    }
  },

  // 点击茶水图标：打开快速计分弹层（茶水）
  onTapTea() {
    if (this.data.readOnly || this.data.info.state !== 1) return
    this.setData({
      showQuickScore: true,
      quickTargetOpenid: '',
      quickTargetName: '茶水费',
      quickAmount: '',
      quickFocus: false
    })
    setTimeout(() => this.setData({ quickFocus: true }), 50)
  },

  onCloseQuickScore() {
    this.setData({ showQuickScore: false, quickFocus: false })
  },

  onQuickInput(e) {
    this.setData({ quickAmount: e.detail.value })
  },

  async onSubmitQuickScore() {
    if (this._submittingScore) return
    const amount = parseInt(this.data.quickAmount, 10)
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入正整数', icon: 'none' })
      return
    }
    const toOpenid = this.data.quickTargetOpenid
    const myOpenid = this.data.myOpenid

    // 客户端预检：3 秒内同一 from→to→amount 不允许重复（含 pending 中的乐观记录）
    const now = Date.now()
    const windowStart = now - 3000
    const allOrders = (this.data.orders || []).concat(this._pendingOrders || [])
    const dup = allOrders.some(o =>
      o.fromOpenid === myOpenid &&
      (o.toOpenid || '') === (toOpenid || '') &&
      o.amount === amount &&
      (o.createdAt || 0) >= windowStart
    )
    if (dup) {
      wx.showToast({ title: '3 秒内不能重复记分', icon: 'none', duration: 2000 })
      return
    }

    this._submittingScore = true
    const myMem = (this.data.visibleMembers || []).find(m => m.userOpenid === myOpenid) || {}
    const toMem = toOpenid ? (this.data.visibleMembers || []).find(m => m.userOpenid === toOpenid) : null
    const optimistic = {
      _id: 'pending_' + now + '_' + Math.random().toString(36).slice(2, 6),
      _pending: true,
      roomId: this.data.id,
      fromOpenid: myOpenid,
      toOpenid: toOpenid || '',
      amount,
      fromNickSnap: myMem.nickName || '',
      toNickSnap: toMem ? toMem.nickName : '',
      createdAt: now
    }
    // 关闭弹层 + 先本地渲染，体感无延迟
    this.setData({ showQuickScore: false, quickFocus: false })
    this._pendingOrders = (this._pendingOrders || []).concat(optimistic)
    this._recalc()
    try {
      const { ok, code, message } = await call('room', {
        action: 'score',
        roomId: this.data.id,
        entries: [{ toOpenid, amount }]
      }, { silent: true })
      if (!ok) {
        // 失败：撤回乐观记录 + 弹窗告知
        this._pendingOrders = (this._pendingOrders || []).filter(o => o._id !== optimistic._id)
        this._recalc()
        const errMsg = message || (code === 'DUPLICATE_SCORE' ? '3 秒内不能重复记分'
          : code === 'NETWORK_ERROR' ? '网络异常，请检查后重试'
          : '记分失败，请重试')
        wx.showModal({
          title: '记分未成功',
          content: errMsg + '，刚才的记录已撤销',
          showCancel: false,
          confirmText: '我知道了'
        })
      }
    } finally {
      this._submittingScore = false
    }
  },

  // 邀请：弹层 + 异步生成小程序码
  async onTapInvite() {
    this.setData({ showInvite: true, inviteQrError: '' })
    if (this._inviteQrUrlCache) {
      this.setData({ inviteQrUrl: this._inviteQrUrlCache })
      return
    }
    if (!this.data.info || !this.data.info.code) {
      this.setData({ inviteQrError: '房间数据加载中，请稍候再试' })
      return
    }
    try {
      const { ok, data, code } = await call('code', {
        roomId: this.data.id,
        code: this.data.info.code
      })
      if (!ok) {
        this.setData({ inviteQrError: code === 'GENERATE_FAILED' ? '生成失败，请稍后重试' : '生成失败' })
        return
      }
      // fileID → https 临时 URL
      const urlRes = await wx.cloud.getTempFileURL({ fileList: [data.fileID] })
      const tempUrl = urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL
      if (tempUrl) {
        this._inviteQrUrlCache = tempUrl
        this.setData({ inviteQrUrl: tempUrl })
      } else {
        this.setData({ inviteQrError: '二维码读取失败' })
      }
    } catch (e) {
      console.error('invite qr generate failed', e)
      this.setData({ inviteQrError: '生成失败，请稍后重试' })
    }
  },

  onCloseInvite() {
    this.setData({ showInvite: false })
  },

  onCopyCode() {
    if (!this.data.info || !this.data.info.code) return
    wx.setClipboardData({ data: this.data.info.code })
  },

  onShowSettlement() {
    // 直接复用 _recalc 已经算好的结果，确保与房间页头像下方数字完全一致
    const cached = this._lastComputed
    if (!cached || !cached.summary || !cached.summary.length) {
      wx.showToast({ title: '暂无数据', icon: 'none' })
      return
    }
    const transfers = settle(cached.summary.map(s => ({
      openid: s.openid,
      nickName: s.nickName,
      score: s.final
    })))
    this.setData({
      showSettlement: true,
      settleData: {
        teaTotal: cached.teaTotal,
        teaShare: cached.teaShare,
        teaShareDisplay: cached.teaShareDisplay,
        memberCount: cached.memberCount,
        summary: cached.summary,
        transfers
      }
    })
  },

  onCloseSettlement() {
    this.setData({ showSettlement: false })
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
      // 退出后跳历史页，并清缓存强制刷新一次
      app._historyCache = null
      wx.showToast({ title: '已退出房间', icon: 'success', duration: 800 })
      setTimeout(() => wx.switchTab({ url: '/pages/history/list' }), 500)
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
      app._historyCache = null
      // toast 显示一下再跳，避免被新页面遮住
      setTimeout(() => wx.switchTab({ url: '/pages/history/list' }), 600)
    }
  },

  onShareAppMessage() {
    const code = (this.data.info && this.data.info.code) || ''
    return {
      title: '邀请你加入牌友记账房间',
      path: '/pages/room/detail?id=' + this.data.id + (code ? '&code=' + code : '')
    }
  }
})
