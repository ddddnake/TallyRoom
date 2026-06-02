const { formatTime } = require('../../utils/format')
const { call } = require('../../utils/cloud')
const app = getApp()

const HIDDEN_STORAGE_KEY = 'history_hidden_room_ids'
// 内存缓存：同一会话内 60 秒内复用，避免每次切 tab 都重拉
const CACHE_TTL_MS = 60 * 1000

function formatDuration(ms) {
  if (!ms || ms < 0) return '0m'
  const totalMin = Math.floor(ms / 60000)
  if (totalMin < 1) return '<1m'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return m + 'm'
  return h + 'h' + (m > 0 ? m + 'm' : '')
}

function getHiddenIds() {
  try {
    const raw = wx.getStorageSync(HIDDEN_STORAGE_KEY)
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    return []
  }
}

function setHiddenIds(ids) {
  try {
    wx.setStorageSync(HIDDEN_STORAGE_KEY, ids)
  } catch (e) {
    console.error('save hidden ids failed', e)
  }
}

// 把云函数返回的精简数据补齐 UI 字段（dateText / durationText / myScoreText / statusLabel）
function decorate(rooms) {
  return rooms.map(r => {
    let statusLabel
    if (r.statusType === 'closed') statusLabel = '已结束'
    else if (r.statusType === 'left') statusLabel = '已离开'
    else statusLabel = '进行中'
    return {
      ...r,
      dateText: r.createdAt ? formatTime(new Date(r.createdAt)) : '',
      durationText: formatDuration(r.durationMs),
      myScoreText: (r.myScore >= 0 ? '+' : '') + r.myScore,
      statusLabel
    }
  })
}

Page({
  data: {
    rooms: [],
    loading: true
  },

  async onShow() {
    const profile = await app.getProfile()
    if (!profile) {
      // 匿名：显示空态，不强制跳引导
      this.setData({ rooms: [], loading: false })
      return
    }
    const myOpenid = profile._openid || profile._id

    // 用上次的缓存先把界面渲出来，避免空白等待
    const cached = app._historyCache
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS && cached.openid === myOpenid) {
      const hiddenSet = new Set(getHiddenIds())
      this.setData({
        rooms: cached.rooms.filter(r => !hiddenSet.has(r._id)),
        loading: false
      })
      return
    }

    // 没缓存（或缓存被清掉强制刷新）→ 显示刷新指示
    this.setData({ loading: true })
    wx.showNavigationBarLoading()

    // sweep 改成 fire-and-forget：不阻塞用户看数据
    call('room', { action: 'sweep' }, { silent: true }).catch(() => {})

    await this._loadHistory(myOpenid)
    wx.hideNavigationBarLoading()
  },

  async _loadHistory(myOpenid) {
    // 一次 RPC 把房间摘要数组直接拿回来；服务端聚合，客户端零分页
    const { ok, data } = await call('room', { action: 'history' }, { silent: true })
    if (!ok || !data) {
      this.setData({ loading: false })
      return
    }

    const allRooms = decorate(data.rooms || [])
    app._historyCache = { rooms: allRooms, ts: Date.now(), openid: myOpenid }

    const hiddenSet = new Set(getHiddenIds())
    this.setData({
      rooms: allRooms.filter(r => !hiddenSet.has(r._id)),
      loading: false
    })
  },

  // 下拉刷新：强制重拉
  async onPullDownRefresh() {
    const profile = await app.getProfile()
    if (!profile) {
      wx.stopPullDownRefresh()
      return
    }
    const myOpenid = profile._openid || profile._id
    app._historyCache = null
    call('room', { action: 'sweep' }, { silent: true }).catch(() => {})
    await this._loadHistory(myOpenid)
    wx.stopPullDownRefresh()
  },

  async onTapRoom(e) {
    const { id, state, status, name } = e.currentTarget.dataset
    // 已结束（房间被关闭）→ 只读浏览
    if (state === 2) {
      wx.navigateTo({ url: '/pages/room/detail?id=' + id + '&readOnly=1' })
      return
    }
    // 进行中 + 我还在场 → 直接进入
    if (status === 'active') {
      wx.navigateTo({ url: '/pages/room/detail?id=' + id + '&readOnly=0' })
      return
    }
    // 已离开（status === 'left'）→ 检查我是否还有别的进行中房间
    const activeRoom = (this.data.rooms || []).find(r => r.statusType === 'active')
    if (activeRoom) {
      const confirm = await new Promise(resolve => {
        wx.showModal({
          title: '需要先离开当前房间',
          content: '你正在「' + activeRoom.name + '」中。重新进入「' + name + '」会先把你从当前房间移出，确定继续吗？',
          confirmText: '继续',
          cancelText: '取消',
          confirmColor: '#ff2a1f',
          success: r => resolve(r.confirm)
        })
      })
      if (!confirm) return
      wx.showLoading({ title: '处理中...', mask: true })
      const { ok } = await call('room', { action: 'leave', roomId: activeRoom._id }, { silent: true })
      wx.hideLoading()
      if (!ok) {
        wx.showToast({ title: '退出失败，请重试', icon: 'none' })
        return
      }
      // 退出成功：使缓存失效，下次进历史 tab 会重拉
      app._historyCache = null
    }
    // 重新加入选中的房间（detail.onShow 会用 fromShare 流程自动 join）
    wx.navigateTo({ url: '/pages/room/detail?id=' + id + '&fromShare=1' })
  },

  onDeleteRoom(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const room = this.data.rooms.find(r => r._id === id)
    const roomName = room ? room.name : '该房间'

    wx.showModal({
      title: '删除记录',
      content: '确定删除「' + roomName + '」吗？\n（仅在你这里隐藏，不影响其他人）',
      confirmText: '删除',
      confirmColor: '#ff2a1f',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        const hidden = getHiddenIds()
        if (!hidden.includes(id)) hidden.push(id)
        setHiddenIds(hidden)
        this.setData({
          rooms: this.data.rooms.filter(r => r._id !== id)
        })
        // 同步缓存：下次切回 tab 不用重拉，且不会再出现这条
        if (app._historyCache && app._historyCache.rooms) {
          app._historyCache.rooms = app._historyCache.rooms.filter(r => r._id !== id)
        }
      }
    })
  }
})
