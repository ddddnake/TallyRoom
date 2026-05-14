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
