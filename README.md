# linoleum

a lightweight, range-request-friendly alternative to parquet, for querying static files on a webpage.

build a `.lino` file ahead of time, put it on any static host that supports http range requests (s3, most cdns), and query it from the browser — fetching only the index plus the few chunks a query actually needs. no wasm, no dependencies.

```js
import { makeFile, readFile } from 'linoleum'

// ahead of time (node)
const lino = makeFile()
lino.schema([
  { id: 'city', type: 'string' }, // schema order = sort order = index priority
  { id: 'temp', type: 'number' },
  { id: 'note', type: 'string', index: false }, // extra payload, not queryable-efficiently
])
lino.rows(rows)
const bytes = await lino.burn('md')
fs.writeFileSync('data-md.lino', bytes)
console.log(lino.report) // chunks, index headroom, suggested size

// on the hot path (browser or node)
const db = await readFile(url, 'md') // one blind range request for the index
const matches = await db.get({ city: 'denver', temp: { $gte: 20 } })
console.log(db.stats()) // bytes fetched, chunks skipped, schema-design hints
```

## how it works

```
[ fixed-size index: sm 16kb · md 64kb · lg 256kb · xl 1mb ]
  magic · version · meta json (schema, chunk geometry)
  per chunk: compressed length + min/max per indexed column
[ chunk 0 ][ chunk 1 ] ...
```

- the index size is hardcoded (`sm/md/lg/xl`) so the first fetch needs no handshake. the reader must be told which size the file uses — a mismatch is detected and recovered, but costs an extra request.
- rows are sorted by the indexed columns in schema order, then split into chunks. each chunk stores min/max per indexed column in the index, so the reader can skip chunks that can't match.
- chunks are column-oriented inside (dictionary / delta+varint / bit-packed encodings, then gzip via the native `CompressionStream`) and fetched whole — one range request per run of adjacent chunks.
- decoded chunks are cached, so repeat queries cost nothing.

## queries

simple mongo-style matching — no sql:

```js
db.get({ foo: 'bar' })              // equality
db.get({ baz: { $gte: 4 } })        // $gt $gte $lt $lte
db.get({ baz: { $ne: 4 } })         // $ne (cannot skip chunks)
db.get({ foo: { $in: ['a', 'b'] }}) // $in
db.get({ foo: 'a', baz: { $lt: 2 }}) // multiple keys are AND-ed
```

types: `boolean`, `number`, `string` — any column may hold `null`.

## designing a schema

schema order decides everything. the first column gets fully-sorted, maximally-prunable zone maps; later columns get progressively fuzzier ones. `db.stats().hints` tells you when a column's min/max pruned nothing, when `$ne` or a non-indexed column forced a scan, and `lino.report.index.suggested` tells you when a smaller index size would fit.

tunables live in [config.js](config.js) and can be overridden per call: `makeFile({ stringPrefixLen: 16 })`, `readFile(url, 'md', { maxGapBytes: 0 })`.

## caveats

- `burn()` is async (gzip streams are async) and returns a `Uint8Array`.
- string min/max are truncated to `stringPrefixLen` utf8 bytes — data whose values share long common prefixes prunes poorly unless you raise it.
- `NaN`/`Infinity` values and `\0` inside strings are not supported.
- string ordering mixes js string compare (sorting/matching) with utf8 byte compare (index prefixes) — identical for ascii and most text, exotic for astral-plane codepoints.
