const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 生成房间小程序码（无限制版本）
 * 入参：{ roomId, code }（房间 id 和邀请码）
 * 返回：{ ok, data: { fileID } }  fileID 是云存储路径，前端用 getTempFileURL 转 https 渲染
 */
exports.main = async (event, context) => {
  const { roomId, code } = event
  if (!roomId || !code) {
    return { ok: false, code: 'INVALID_PARAMS', message: '缺少参数' }
  }

  try {
    // scene 参数：最多 32 字符，URL-safe；这里用 roomId 和 code 拼接
    // 路径用 pages/room/detail，scene 在小程序端从 onLoad options.scene 解析
    const scene = code  // 邀请码已经是 6 位大写字母数字，符合 scene 字符要求
    const res = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page: 'pages/room/detail',
      checkPath: false,    // 体验版未发布时也允许生成
      envVersion: 'trial', // trial=体验版，develop=开发版，release=正式版
      width: 280
    })

    // res.buffer 是 PNG 二进制；存到云存储后返回 fileID
    const upload = await cloud.uploadFile({
      cloudPath: 'qrcodes/' + roomId + '_' + Date.now() + '.png',
      fileContent: res.buffer
    })

    return { ok: true, data: { fileID: upload.fileID } }
  } catch (e) {
    console.error('wxacode failed:', e)
    return { ok: false, code: 'GENERATE_FAILED', message: e.errMsg || String(e) }
  }
}
