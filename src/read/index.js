// hot-path side: fetch the fixed index blind, then range-read only the chunks a query needs
import config from '../../config.js'
import { concatBytes } from '../_lib/util.js'
import { ByteReader } from '../_lib/bytes.js'
import { decodeColumn } from '../_lib/column.js'
import { gunzip } from '../_lib/gzip.js'
import { parseMeta, parseChunks } from '../_lib/index-format.js'
import { normalizeQuery, matches, mayMatch } from './query.js'
import { makeStats } from './stats.js'

const fetchRange = async (url, start, end, stats) => {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
  if (!res.ok) {
    throw new Error(`fetch failed (${res.status}) for ${url}`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  stats.requests += 1
  stats.bytesFetched += bytes.length
  if (res.status === 200) {
    stats.hint('server ignored the range request — sent the whole file')
  }
  return { bytes, status: res.status }
}

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

export const readFile = async (url, size, opts = {}) => {
  const cfg = { ...config, ...opts }
  const askedSize = cfg.indexSizes[size]
  if (!askedSize) {
    throw new Error(`unknown index size '${size}' — use ${Object.keys(cfg.indexSizes).join('/')}`)
  }
  const stats = makeStats()
  const head = await fetchRange(url, 0, askedSize - 1, stats)
  let full = head.status === 200 ? head.bytes : null // whole file, if the server can't do ranges
  let bytes = head.bytes
  const meta = parseMeta(bytes)
  if (meta.size !== size) {
    stats.hint(`file has a '${meta.size}' index but was opened as '${size}' — pass '${meta.size}' to avoid wasted bytes`)
  }
  if (meta.indexSize > bytes.length) {
    const rest = await fetchRange(url, bytes.length, meta.indexSize - 1, stats)
    bytes = concatBytes([bytes, rest.bytes])
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
    const sliceFrom = (buf, base, i) => buf.slice(chunks[i].offset - base, chunks[i].offset - base + chunks[i].byteLength)
    if (full) {
      need.forEach((i) => buffers.set(i, sliceFrom(full, 0, i)))
    } else {
      const ranges = coalesce(need, chunks, cfg.maxGapBytes)
      await Promise.all(
        ranges.map(async (range) => {
          const res = await fetchRange(url, range.start, range.end, stats)
          if (res.status === 200) {
            full = res.bytes
            range.ids.forEach((i) => buffers.set(i, sliceFrom(full, 0, i)))
          } else {
            range.ids.forEach((i) => buffers.set(i, sliceFrom(res.bytes, range.start, i)))
          }
        })
      )
    }
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

  return { meta, get, stats: () => stats.summary() }
}
