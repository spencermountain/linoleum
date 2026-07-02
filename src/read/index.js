// hot-path side: read the fixed index blind, then range-read only the chunks a query needs
// works over any byte source — see from-url.js and from-disk.js
import config from '../../config.js'
import { concatBytes } from '../_lib/util.js'
import { ByteReader } from '../_lib/bytes.js'
import { decodeColumn } from '../_lib/column.js'
import { gunzip } from '../_lib/gzip.js'
import { parseMeta, parseChunks } from '../_lib/index-format.js'
import { normalizeQuery, matches, mayMatch } from './query.js'
import { makeStats } from './stats.js'

// merge wanted chunk ids (ascending) into few byte ranges, jumping small gaps
const coalesce = (ids, chunks, maxGap) => {
  const ranges = []
  for (const i of ids) {
    const start = chunks[i].offset
    const end = start + chunks[i].byteLength - 1
    const last = ranges[ranges.length - 1]
    if (last && start - last.end - 1 <= maxGap) {
      last.end = end
      last.ids.push(i)
    } else {
      ranges.push({ start, end, ids: [i] })
    }
  }
  return ranges
}

// decompressed chunk blob → row objects
const decodeChunk = (blob, meta, nRows) => {
  const r = new ByteReader(blob)
  const colCount = r.u16()
  const lens = []
  for (let i = 0; i < colCount; i += 1) {
    lens.push(r.u32())
  }
  const cols = meta.schema.map((col, i) => decodeColumn(r.raw(lens[i]), col.type, nRows))
  const rows = new Array(nRows)
  for (let i = 0; i < nRows; i += 1) {
    const row = {}
    meta.schema.forEach((col, j) => {
      row[col.id] = cols[j][i]
    })
    rows[i] = row
  }
  return rows
}

// shared reader core — source: {read(start, end) → {bytes, whole?}, close?()}
export const open = async (source, size, opts = {}) => {
  const cfg = { ...config, ...opts }
  const askedSize = cfg.indexSizes[size]
  if (!askedSize) {
    throw new Error(`unknown index size '${size}' — use ${Object.keys(cfg.indexSizes).join('/')}`)
  }
  const stats = makeStats()
  let full = null // whole file, when a source can't do ranges

  // range-read (inclusive end) with stats + whole-file fallback
  const read = async (start, end) => {
    if (full) {
      return full.slice(start, end + 1)
    }
    const res = await source.read(start, end)
    stats.requests += 1
    stats.bytesFetched += res.bytes.length
    if (res.whole) {
      full = res.bytes
      stats.hint('the range request was ignored — the whole file was sent')
      return full.slice(start, end + 1)
    }
    return res.bytes
  }

  let bytes = await read(0, askedSize - 1)
  const meta = parseMeta(bytes)
  if (meta.size !== size) {
    stats.hint(`file has a '${meta.size}' index but was opened as '${size}' — pass '${meta.size}' to avoid wasted bytes`)
  }
  if (meta.indexSize > bytes.length) {
    bytes = concatBytes([bytes, await read(bytes.length, meta.indexSize - 1)])
  }
  const chunks = parseChunks(bytes, meta)
  stats.chunksTotal = chunks.length
  stats.fileBytes = meta.indexSize + chunks.reduce((n, c) => n + c.byteLength, 0)
  const cache = new Map() // chunk id → decoded rows
  const rowsInChunk = (i) => {
    if (i < meta.chunks - 1) {
      return meta.perChunk
    }
    return meta.rows - (meta.chunks - 1) * meta.perChunk
  }

  const loadChunks = async (ids) => {
    const need = ids.filter((i) => !cache.has(i))
    if (need.length === 0) {
      return
    }
    const buffers = new Map() // chunk id → compressed bytes
    const ranges = coalesce(need, chunks, cfg.maxGapBytes)
    await Promise.all(
      ranges.map(async (range) => {
        const win = await read(range.start, range.end)
        range.ids.forEach((i) => {
          const at = chunks[i].offset - range.start
          buffers.set(i, win.slice(at, at + chunks[i].byteLength))
        })
      })
    )
    await Promise.all(
      need.map(async (i) => {
        const blob = meta.gzip ? await gunzip(buffers.get(i)) : buffers.get(i)
        cache.set(i, decodeChunk(blob, meta, rowsInChunk(i)))
      })
    )
    stats.chunksFetched += need.length
  }

  const get = async (query) => {
    stats.gets += 1
    const conds = normalizeQuery(query, meta.schema)
    for (const c of conds) {
      if (!c.col.index) {
        stats.hint(`column '${c.id}' is not indexed — it cannot skip chunks`)
      }
      if (c.op === '$ne') {
        stats.hint(`$ne cannot skip chunks (column '${c.id}')`)
      }
    }
    const indexed = conds.filter((c) => c.col.index)
    const wanted = []
    chunks.forEach((chunk, i) => {
      if (indexed.every((c) => mayMatch(chunk.cols[c.id], c, meta.prefixLen))) {
        wanted.push(i)
      }
    })
    // per-column pruning feedback — the schema-order design signal
    if (chunks.length > 1) {
      for (const c of indexed) {
        if (c.op === '$ne') {
          continue
        }
        const kept = chunks.filter((ch) => mayMatch(ch.cols[c.id], c, meta.prefixLen)).length
        if (kept === chunks.length) {
          stats.hint(`'${c.id}' min/max pruned nothing — an earlier schema position would help`)
        }
      }
    }
    await loadChunks(wanted)
    const out = []
    for (const i of wanted) {
      for (const row of cache.get(i)) {
        if (matches(row, conds)) {
          out.push(row)
        }
      }
    }
    return out
  }

  const close = async () => {
    if (source.close) {
      await source.close()
    }
  }

  return { meta, get, close, stats: () => stats.summary() }
}
