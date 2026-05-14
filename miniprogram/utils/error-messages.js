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
