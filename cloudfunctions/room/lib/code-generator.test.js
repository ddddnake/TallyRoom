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
