const { formatTime } = require('../../utils/format')
const { call } = require('../../utils/cloud')
const app = getApp()

const HIDDEN_STORAGE_KEY = 'history_hidden_room_ids'

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

Page({
  data: {
    rooms: [],
    loading: true
  },

  async onShow() {
    const profile = await app.getProfile()
    if (!profile) {
      wx.redirectTo({ url: '/pages/setup/profile' })
      return
    }
    const myOpenid = profile._openid || profile._id

    // 进入历史页前先 sweep 一次，把所有过期房间关掉
    await call('room', { action: 'sweep' }, { silent: true })

    const db = wx.cloud.database()
    const me = await db.collection('room_members')
      .where({ userOpenid: myOpenid })
      .orderBy('joinedAt', 'desc')
      .get()

    if (!me.data.length) {
      this.setData({ rooms: [], loading: false })
      return
    }

    // 我的成员记录按 roomId 索引，方便后面拿"我加入时刻"
    const myMemberByRoom = {}
    me.data.forEach(m => {
      if (!myMemberByRoom[m.roomId] || m.joinedAt > myMemberByRoom[m.roomId].joinedAt) {
        myMemberByRoom[m.roomId] = m
      }
    })

    const roomIds = Object.keys(myMemberByRoom)
    const _ = db.command
    const roomData = await db.collection('rooms')
      .where({ _id: _.in(roomIds) })
      .get()

    // 一次性拉所有相关 orders（限定我参与过的房间），按房间分组算时长和得分
    const ordersData = await db.collection('room_orders')
      .where({ roomId: _.in(roomIds) })
      .get()
    const ordersByRoom = {}
    ;(ordersData.data || []).forEach(o => {
      if (!ordersByRoom[o.roomId]) ordersByRoom[o.roomId] = []
      ordersByRoom[o.roomId].push(o)
    })

    const hiddenSet = new Set(getHiddenIds())

    const rooms = (roomData.data || [])
      .filter(r => !hiddenSet.has(r._id))
      .map(r => {
      const myMem = myMemberByRoom[r._id]
      const myJoinedAt = myMem ? (myMem.joinedAt || 0) : 0
      const orders = ordersByRoom[r._id] || []

      // 我相关的最后一笔订单时间
      let lastMyOrderAt = myJoinedAt
      let myScore = 0
      orders.forEach(o => {
        const involved = (o.fromOpenid === myOpenid) || (o.toOpenid === myOpenid)
        if (involved && o.createdAt > lastMyOrderAt) lastMyOrderAt = o.createdAt
        if (o.toOpenid === myOpenid) myScore += (o.amount || 0)
        if (o.fromOpenid === myOpenid) myScore -= (o.amount || 0)
      })

      const durationMs = lastMyOrderAt && myJoinedAt ? (lastMyOrderAt - myJoinedAt) : 0

      // 状态标签：房间已关闭 → "已结束"；房间在但我退了 → "已离开"；都活跃 → "进行中"
      let statusLabel, statusType
      if (r.state === 2) {
        statusLabel = '已结束'
        statusType = 'closed'
      } else if (myMem && myMem.state !== 1) {
        statusLabel = '已离开'
        statusType = 'left'
      } else {
        statusLabel = '进行中'
        statusType = 'active'
      }

      return {
        ...r,
        dateText: r.createdAt ? formatTime(new Date(r.createdAt)) : '',
        durationText: formatDuration(durationMs),
        myScore,
        myScoreText: (myScore >= 0 ? '+' : '') + myScore,
        statusLabel,
        statusType
      }
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

    this.setData({ rooms, loading: false })
  },

  onTapRoom(e) {
    const { id, state } = e.currentTarget.dataset
    const readOnly = state === 2 ? '1' : '0'
    wx.navigateTo({ url: '/pages/room/detail?id=' + id + '&readOnly=' + readOnly })
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
      }
    })
  }
})
