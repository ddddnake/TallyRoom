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
