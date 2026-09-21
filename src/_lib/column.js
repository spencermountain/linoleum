/* eslint-disable no-bitwise */
// per-column encoding — one small blob per column per chunk
// layout: [u8 encoding][u8 hasNulls][presence bitmap?][payload of dense non-null values]
import { ByteWriter, ByteReader } from './bytes.js'
import { toUtf8, fromUtf8 } from './util.js'

const BOOL = 1 // bit-packed booleans
const NUM_F64 = 2 // raw float64s
const NUM_DELTA = 3 // delta + zigzag varints
const STR_PLAIN = 4 // length-prefixed utf8
const STR_DICT = 5 // dictionary + varint indexes

const SAFE = 2 ** 51 // deltas double under zigzag — stay well inside float53 precision

const pickEncoding = (type, dense, cfg) => {
  if (type === 'boolean') {
    return BOOL
  }
  if (type === 'number') {
    const ints = dense.every((v) => Number.isInteger(v) && Math.abs(v) < SAFE)
    return ints ? NUM_DELTA : NUM_F64
  }
  const uniq = new Set(dense)
  return uniq.size <= dense.length * cfg.dictMaxRatio ? STR_DICT : STR_PLAIN
}

// bit set = value present (non-null)
const presenceBitmap = (values) => {
  const bytes = new Uint8Array(Math.ceil(values.length / 8))
  values.forEach((v, i) => {
    if (v !== null) {
      bytes[i >> 3] |= 1 << (i & 7)
    }
  })
  return bytes
}

const writePayload = (w, encId, dense) => {
  if (encId === BOOL) {
    const bytes = new Uint8Array(Math.ceil(dense.length / 8))
    dense.forEach((v, i) => {
      if (v) {
        bytes[i >> 3] |= 1 << (i & 7)
      }
    })
    w.raw(bytes)
    return
  }
  if (encId === NUM_F64) {
    dense.forEach((v) => w.f64(v))
    return
  }
  if (encId === NUM_DELTA) {
    let prev = 0
    dense.forEach((v) => {
      w.zigzag(v - prev)
      prev = v
    })
    return
  }
  if (encId === STR_PLAIN) {
    dense.forEach((v) => {
      const b = toUtf8(v)
      w.varint(b.length)
      w.raw(b)
    })
    return
  }
  // STR_DICT
  const dict = [...new Set(dense)]
  const idx = new Map(dict.map((v, i) => [v, i]))
  w.varint(dict.length)
  dict.forEach((v) => {
    const b = toUtf8(v)
    w.varint(b.length)
    w.raw(b)
  })
  dense.forEach((v) => w.varint(idx.get(v)))
}

const readPayload = (r, encId, n) => {
  const out = new Array(n)
  if (encId === BOOL) {
    const bytes = r.raw(Math.ceil(n / 8))
    for (let i = 0; i < n; i += 1) {
      out[i] = (bytes[i >> 3] & (1 << (i & 7))) !== 0
    }
    return out
  }
  if (encId === NUM_F64) {
    for (let i = 0; i < n; i += 1) {
      out[i] = r.f64()
    }
    return out
  }
  if (encId === NUM_DELTA) {
    let prev = 0
    for (let i = 0; i < n; i += 1) {
      prev += r.zigzag()
      out[i] = prev
    }
    return out
  }
  if (encId === STR_PLAIN) {
    for (let i = 0; i < n; i += 1) {
      out[i] = fromUtf8(r.raw(r.varint()))
    }
    return out
  }
  if (encId === STR_DICT) {
    const dict = new Array(r.varint())
    for (let i = 0; i < dict.length; i += 1) {
      dict[i] = fromUtf8(r.raw(r.varint()))
    }
    for (let i = 0; i < n; i += 1) {
      out[i] = dict[r.varint()]
    }
    return out
  }
  throw new Error(`unknown column encoding ${encId}`)
}

export const encodeColumn = (type, values, cfg) => {
  const w = new ByteWriter()
  const dense = values.filter((v) => v !== null)
  const hasNulls = dense.length < values.length
  const encId = pickEncoding(type, dense, cfg)
  w.u8(encId)
  w.u8(hasNulls ? 1 : 0)
  if (hasNulls) {
    w.raw(presenceBitmap(values))
  }
  writePayload(w, encId, dense)
  return w.done()
}

export const decodeColumn = (bytes, type, rowCount) => {
  const r = new ByteReader(bytes)
  const encId = r.u8()
  const hasNulls = r.u8() === 1
  if (!hasNulls) {
    return readPayload(r, encId, rowCount)
  }
  const present = r.raw(Math.ceil(rowCount / 8))
  let denseCount = 0
  for (let i = 0; i < rowCount; i += 1) {
    if (present[i >> 3] & (1 << (i & 7))) {
      denseCount += 1
    }
  }
  const dense = readPayload(r, encId, denseCount)
  const out = new Array(rowCount)
  let j = 0
  for (let i = 0; i < rowCount; i += 1) {
    out[i] = present[i >> 3] & (1 << (i & 7)) ? dense[j++] : null
  }
  return out
}
