// mongo-ish query matching + chunk pruning against index min/max stats
import { cmp, cmpBytes, utf8Prefix } from '../_lib/util.js'

const OPS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in']

const checkValue = (v, col) => {
  if (v !== null && typeof v !== col.type) {
    throw new Error(`column '${col.id}' expects ${col.type}, got ${JSON.stringify(v)}`)
  }
}

// {foo: 1, bar: {$gte: 2}} → [{id, op, value, col}, ...]
export const normalizeQuery = (query, schema) => {
  const byId = Object.fromEntries(schema.map((c) => [c.id, c]))
  const conds = []
  for (const [id, v] of Object.entries(query)) {
    const col = byId[id]
    if (!col) {
      throw new Error(`unknown column '${id}'`)
    }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [op, value] of Object.entries(v)) {
        if (!OPS.includes(op)) {
          throw new Error(`unknown operator '${op}'`)
        }
        if (op === '$in') {
          if (!Array.isArray(value)) {
            throw new Error(`$in expects an array (column '${id}')`)
          }
          value.forEach((el) => checkValue(el, col))
        } else {
          checkValue(value, col)
        }
        conds.push({ id, op, value, col })
      }
    } else {
      checkValue(v, col)
      conds.push({ id, op: '$eq', value: v, col })
    }
  }
  return conds
}

const testOp = (v, op, want) => {
  if (op === '$eq') {
    return v === want
  }
  if (op === '$ne') {
    return v !== want
  }
  if (op === '$in') {
    return want.includes(v)
  }
  if (v === null || want === null) {
    return false // nulls never satisfy range ops
  }
  if (op === '$gt') {
    return v > want
  }
  if (op === '$gte') {
    return v >= want
  }
  if (op === '$lt') {
    return v < want
  }
  return v <= want // $lte
}

export const matches = (row, conds) => conds.every((c) => testOp(row[c.id], c.op, c.value))

// could this chunk hold a matching row? conservative — false means safe to skip
// s: {hasNonNull, hasNull, min, max} — string min/max are truncated utf8 prefixes
export const mayMatch = (s, cond, prefixLen) => {
  const { op, col } = cond
  const want = cond.value
  if (op === '$in') {
    return want.some((v) => mayMatch(s, { op: '$eq', value: v, col }, prefixLen))
  }
  if (want === null) {
    if (op === '$eq') {
      return s.hasNull
    }
    if (op === '$ne') {
      return s.hasNonNull
    }
    return false // range ops never match null
  }
  if (op === '$ne') {
    // prunable only when every row provably equals the value
    if (s.hasNull || !s.hasNonNull || col.type === 'string') {
      return true
    }
    return !(s.min === s.max && s.min === want)
  }
  if (!s.hasNonNull) {
    return false
  }
  let lo // want vs chunk min
  let hi // want vs chunk max
  if (col.type === 'string') {
    const p = utf8Prefix(want, prefixLen)
    lo = cmpBytes(p, s.min)
    hi = cmpBytes(p, s.max)
  } else {
    lo = cmp(want, s.min)
    hi = cmp(want, s.max)
  }
  // truncated string prefixes make exact ties ambiguous — keep the chunk on a tie
  const tie = col.type === 'string'
  if (op === '$eq') {
    return lo >= 0 && hi <= 0
  }
  if (op === '$gt') {
    return tie ? hi <= 0 : hi < 0
  }
  if (op === '$gte') {
    return hi <= 0
  }
  if (op === '$lt') {
    return tie ? lo >= 0 : lo > 0
  }
  return lo >= 0 // $lte
}
