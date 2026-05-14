const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 排除 O/0/I/1

function generate() {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

module.exports = { generate }
