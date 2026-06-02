class InMemoryDB {
  constructor() {
    this._collections = {}
    this.command = {
      gte: (val) => ({ _op: 'gte', value: val }),
      lte: (val) => ({ _op: 'lte', value: val }),
      in: (arr) => ({ _op: 'in', value: arr }),
      and: function (...conds) {
        return { _op: 'and', conditions: conds.flat() }
      },
      or: function (...conds) {
        return { _topOp: 'or', branches: conds.flat() }
      }
    }
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
      update: async (params) => {
        if (!rec) throw new Error(`doc ${id} not found in ${this.name}`)
        Object.assign(rec, params.data || params)
        return { stats: { updated: 1 } }
      },
      set: async (params) => {
        const docData = params.data || params
        const idx = this._records.findIndex(r => r._id === id)
        if (idx >= 0) {
          Object.assign(this._records[idx], docData)
        } else {
          this._records.push({ _id: id, ...docData })
        }
        return { stats: { updated: 1 } }
      }
    }
  }

  where(query) {
    return this._buildQuery(query, null, null)
  }

  _buildQuery(query, sort, limitN, skipN) {
    const self = this
    function matchValue(actual, cond) {
      if (cond && typeof cond === 'object' && cond._op) {
        if (cond._op === 'gte') return actual >= cond.value
        if (cond._op === 'lte') return actual <= cond.value
        if (cond._op === 'in') return Array.isArray(cond.value) && cond.value.includes(actual)
        if (cond._op === 'and') {
          return cond.conditions.every(c => matchValue(actual, c))
        }
      }
      return actual === cond
    }
    function matchRecord(record, q) {
      // 顶层 or：q 形如 { _topOp: 'or', branches: [{...}, {...}] }
      if (q && q._topOp === 'or') {
        return q.branches.some(b => matchRecord(record, b))
      }
      return Object.entries(q).every(([k, v]) => matchValue(record[k], v))
    }
    const matchAll = () => self._records.filter(r => matchRecord(r, query))
    return {
      get: async () => {
        let arr = matchAll()
        if (sort) arr = arr.slice().sort((a, b) => {
          const va = a[sort.field], vb = b[sort.field]
          return sort.dir === 'desc' ? vb - va : va - vb
        })
        if (skipN != null) arr = arr.slice(skipN)
        if (limitN != null) arr = arr.slice(0, limitN)
        return { data: arr }
      },
      orderBy: (field, dir) => self._buildQuery(query, { field, dir }, limitN, skipN),
      limit: (n) => self._buildQuery(query, sort, n, skipN),
      skip: (n) => self._buildQuery(query, sort, limitN, n),
      remove: async () => {
        const before = self._records.length
        self._records = self._records.filter(r => !matchRecord(r, query))
        return { stats: { removed: before - self._records.length } }
      }
    }
  }

  add(params) {
    const docData = params.data || params
    const rec = { _id: String(this._nextId++), ...docData }
    this._records.push(rec)
    return { _id: rec._id }
  }
}

const MOCK_NOW = Date.now()
function mockServerDate() { return MOCK_NOW }

module.exports = { InMemoryDB, mockServerDate }
