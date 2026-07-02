// binary layout of the fixed-size index region at the top of a .lino file
//   [4 magic "LINO"][1 version][1 size code][2 json length][meta json]
//   [chunk table][zero padding out to the fixed index size]
// chunk table entry: u32 compressed byteLength, then per indexed column:
//   u8 flags (1=hasNonNull, 2=hasNull) + min/max by type
//   boolean: u8+u8 · number: f64+f64 · string: prefixLen bytes each, zero-padded
import { ByteWriter, ByteReader } from './bytes.js'
import { toUtf8, fromUtf8, trimZeros } from './util.js'

export const SIZE_CODES = ['sm', 'md', 'lg', 'xl']
const MAGIC = 'LINO'
const VERSION = 1

// index bytes each chunk costs, for a given schema
export const entryBytes = (schema, prefixLen) => {
  let n = 4 // compressed chunk length
  for (const col of schema) {
    if (!col.index) {
      continue
    }
    n += 1 // flags
    if (col.type === 'boolean') {
      n += 2
    }
    if (col.type === 'number') {
      n += 16
    }
    if (col.type === 'string') {
      n += prefixLen * 2
    }
  }
  return n
}

const pad = (bytes, len) => {
  const out = new Uint8Array(len)
  out.set(bytes.slice(0, len))
  return out
}

export const writeIndex = (meta, chunkStats, indexSize) => {
  const w = new ByteWriter(indexSize)
  w.raw(toUtf8(MAGIC))
  w.u8(VERSION)
  const code = SIZE_CODES.indexOf(meta.size)
  w.u8(code === -1 ? 255 : code)
  const json = toUtf8(JSON.stringify(meta))
  if (json.length > 65535) {
    throw new Error('schema too large — meta header exceeds 64kb')
  }
  w.u16(json.length)
  w.raw(json)
  for (const c of chunkStats) {
    w.u32(c.byteLength)
    for (const col of meta.schema) {
      if (!col.index) {
        continue
      }
      const s = c.cols[col.id]
      w.u8((s.hasNonNull ? 1 : 0) + (s.hasNull ? 2 : 0))
      if (col.type === 'boolean') {
        w.u8(s.min ? 1 : 0)
        w.u8(s.max ? 1 : 0)
      }
      if (col.type === 'number') {
        w.f64(s.hasNonNull ? s.min : 0)
        w.f64(s.hasNonNull ? s.max : 0)
      }
      if (col.type === 'string') {
        w.raw(pad(s.min || new Uint8Array(0), meta.prefixLen))
        w.raw(pad(s.max || new Uint8Array(0), meta.prefixLen))
      }
    }
  }
  const used = w.pos
  if (used > indexSize) {
    throw new Error(`index overflow — ${used} bytes into a ${indexSize} byte region`)
  }
  const out = new Uint8Array(indexSize) // zero padding for free
  out.set(w.done())
  return { bytes: out, used }
}

// header only — safe on a partial fetch, the json always fits in the smallest size
export const parseMeta = (bytes) => {
  const r = new ByteReader(bytes)
  if (fromUtf8(r.raw(4)) !== MAGIC) {
    throw new Error('not a lino file')
  }
  const version = r.u8()
  if (version !== VERSION) {
    throw new Error(`unsupported lino version ${version}`)
  }
  r.u8() // size code — meta json is authoritative
  return JSON.parse(fromUtf8(r.raw(r.u16())))
}

// full chunk table — needs the whole index region in `bytes`
export const parseChunks = (bytes, meta) => {
  const r = new ByteReader(bytes)
  r.pos = 6
  r.pos += 2 + r.u16() // skip meta json
  const chunks = []
  let offset = meta.indexSize
  for (let i = 0; i < meta.chunks; i += 1) {
    const c = { byteLength: r.u32(), offset, cols: {} }
    for (const col of meta.schema) {
      if (!col.index) {
        continue
      }
      const flags = r.u8()
      const s = { hasNonNull: (flags & 1) !== 0, hasNull: (flags & 2) !== 0 }
      if (col.type === 'boolean') {
        s.min = r.u8() === 1
        s.max = r.u8() === 1
      }
      if (col.type === 'number') {
        s.min = r.f64()
        s.max = r.f64()
      }
      if (col.type === 'string') {
        s.min = trimZeros(r.raw(meta.prefixLen))
        s.max = trimZeros(r.raw(meta.prefixLen))
      }
      c.cols[col.id] = s
    }
    offset += c.byteLength
    chunks.push(c)
  }
  return chunks
}
