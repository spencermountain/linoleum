// ahead-of-time side: schema → sorted rows → chunked, compressed .lino bytes
import config from '../../config.js'
import { cmp, utf8Prefix, concatBytes } from '../_lib/util.js'
import { ByteWriter } from '../_lib/bytes.js'
import { encodeColumn } from '../_lib/column.js'
import { gzip } from '../_lib/gzip.js'
import { writeIndex, entryBytes } from '../_lib/index-format.js'

const TYPES = ['boolean', 'number', 'string']

const normalizeSchema = (cols) => {
  const seen = new Set()
  return cols.map((c) => {
    if (!c.id || typeof c.id !== 'string' || seen.has(c.id)) {
      throw new Error(`schema column needs a unique string id: ${JSON.stringify(c)}`)
    }
    if (!TYPES.includes(c.type)) {
      throw new Error(`column '${c.id}' has unknown type '${c.type}' — use ${TYPES.join('/')}`)
    }
    seen.add(c.id)
    return { id: c.id, type: c.type, index: c.index !== false }
  })
}

const normalizeRow = (row, schema) => {
  const out = {}
  for (const col of schema) {
    const v = row[col.id]
    if (v === undefined || v === null) {
      out[col.id] = null
      continue
    }
    // isFinite also rejects NaN/Infinity — they have no sane min/max ordering
    if (typeof v !== col.type || (col.type === 'number' && !Number.isFinite(v))) {
      throw new Error(`column '${col.id}' expects ${col.type}, got ${JSON.stringify(v)}`)
    }
    out[col.id] = v
  }
  return out
}

// sort by indexed columns in schema order — this is what makes min/max pruning work
const sortRows = (rows, schema) => {
  const keys = schema.filter((c) => c.index).map((c) => c.id)
  rows.sort((a, b) => {
    for (const k of keys) {
      const n = cmp(a[k], b[k])
      if (n !== 0) {
        return n
      }
    }
    return 0
  })
}

// min/max/null flags per indexed column, for one chunk of rows
const colStats = (rows, schema, prefixLen) => {
  const stats = {}
  for (const col of schema) {
    if (!col.index) {
      continue
    }
    const vals = rows.map((r) => r[col.id]).filter((v) => v !== null)
    const s = { hasNonNull: vals.length > 0, hasNull: vals.length < rows.length }
    if (vals.length > 0) {
      let min = vals[0]
      let max = vals[0]
      for (const v of vals) {
        if (cmp(v, min) < 0) {
          min = v
        }
        if (cmp(v, max) > 0) {
          max = v
        }
      }
      s.min = col.type === 'string' ? utf8Prefix(min, prefixLen) : min
      s.max = col.type === 'string' ? utf8Prefix(max, prefixLen) : max
    }
    stats[col.id] = s
  }
  return stats
}

// chunk blob: [u16 colCount][u32 encoded length × col][column blobs in schema order]
const encodeChunk = async (rows, schema, cfg) => {
  const cols = schema.map((col) =>
    encodeColumn(
      col.type,
      rows.map((r) => r[col.id]),
      cfg
    )
  )
  const w = new ByteWriter()
  w.u16(cols.length)
  cols.forEach((c) => w.u32(c.length))
  cols.forEach((c) => w.raw(c))
  const blob = w.done()
  return cfg.gzip ? gzip(blob) : blob
}

export const makeFile = (opts = {}) => {
  const cfg = { ...config, ...opts }
  let schema = null
  let rows = []
  const api = {
    report: null,
    schema(cols) {
      schema = normalizeSchema(cols)
      return api
    },
    rows(list) {
      rows = rows.concat(list)
      return api
    },
    async burn(size) {
      const indexSize = cfg.indexSizes[size]
      if (!indexSize) {
        throw new Error(`unknown index size '${size}' — use ${Object.keys(cfg.indexSizes).join('/')}`)
      }
      if (!schema) {
        throw new Error('call .schema() before .burn()')
      }
      const data = rows.map((r) => normalizeRow(r, schema))
      sortRows(data, schema)
      const meta = {
        size,
        indexSize,
        schema,
        rows: data.length,
        prefixLen: cfg.stringPrefixLen,
        gzip: cfg.gzip,
      }
      // reason chunk geometry down from the index budget
      const headerGuess = 8 + JSON.stringify({ ...meta, chunks: 99999999, perChunk: 99999999 }).length
      const perEntry = entryBytes(schema, meta.prefixLen)
      const maxChunks = Math.floor((indexSize - headerGuess) / perEntry)
      if (maxChunks < 1) {
        throw new Error(`schema does not fit in a '${size}' index`)
      }
      const perChunk = Math.max(cfg.minChunkRows, Math.ceil(data.length / maxChunks) || 1)
      const chunkCount = Math.ceil(data.length / perChunk)
      meta.perChunk = perChunk
      meta.chunks = chunkCount
      const chunkStats = []
      const blobs = []
      for (let i = 0; i < chunkCount; i += 1) {
        const slice = data.slice(i * perChunk, (i + 1) * perChunk)
        const blob = await encodeChunk(slice, schema, cfg)
        blobs.push(blob)
        chunkStats.push({ byteLength: blob.length, cols: colStats(slice, schema, meta.prefixLen) })
      }
      const index = writeIndex(meta, chunkStats, indexSize)
      const out = concatBytes([index.bytes, ...blobs])
      // smallest configured size this index would fit in — every reader pays for the index
      const fits = Object.entries(cfg.indexSizes)
        .filter(([, n]) => index.used + 64 <= n)
        .sort((a, b) => a[1] - b[1])
      api.report = {
        rows: data.length,
        chunks: chunkCount,
        rowsPerChunk: perChunk,
        fileBytes: out.length,
        dataBytes: out.length - indexSize,
        index: {
          size: indexSize,
          used: index.used,
          free: indexSize - index.used,
          maxChunks,
          suggested: fits.length > 0 ? fits[0][0] : size,
        },
      }
      return out
    },
  }
  return api
}
