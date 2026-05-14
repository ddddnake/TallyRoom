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

  _insert(record) {
    const rec = { ...record }
    if (!rec._id) rec._id = String(this._nextId++)
    this._records.push(rec)
    return rec
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
      },
      set: async ({ data }) => {
        const idx = this._records.findIndex(r => r._id === id)
        if (idx >= 0) {
          Object.assign(this._records[idx], data)
        } else {
          this._records.push({ _id: id, ...data })
        }
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
      },
      remove: async () => {
        const before = this._records.length
        this._records = records.filter(r => {
          return !Object.entries(query).every(([k, v]) => r[k] === v)
        })
        return { stats: { removed: before - this._records.length } }
      }
    }
  }

  add({ data }) {
    const rec = { _id: String(this._nextId++), ...data }
    this._records.push(rec)
    return { _id: rec._id }
  }
}

const MOCK_NOW = Date.now()
function mockServerDate() { return MOCK_NOW }

module.exports = { InMemoryDB, mockServerDate }
