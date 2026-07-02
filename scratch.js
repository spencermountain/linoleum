import { makeFile, fromUrl, fromDisk } from './src/index.js'
import { makePenguins } from './lib/penguin-data.js'
import fs from 'node:fs'

const rowCount = 10_000
const size = 'md'
const rows = makePenguins(rowCount, Math.random() * 100)

const lino = makeFile()
lino.schema([
  { id: 'species', type: 'string' }, // schema order = sort order = index priority
  { id: 'island', type: 'string' },
  { id: 'body_mass_g', type: 'number' },
  { id: 'flipper_length_mm', type: 'number' },
  { id: 'bill_length_mm', type: 'number', index: false }, // extra payload, not queryable-efficiently
  { id: 'bill_depth_mm', type: 'number', index: false },
  { id: 'sex', type: 'string', index: false },
  { id: 'year', type: 'number', index: false },
])
lino.rows(rows)
console.log(lino.report) // chunks, index headroom, suggested size
const bytes = await lino.burn(size)
fs.writeFileSync(`./penguins-${size}.lino`, bytes)
await lino.close()


// read it straight off disk
const lin = await fromDisk(path, size)
const query = { species: 'Gentoo', body_mass_g: { $gte: 5500 } }
const results = await lin.get(query)
console.log(results)
console.log(`\n${results.length} gentoos of ${rowCount} penguins`)
console.log('disk:', lino.stats()) // bytes read, chunks skipped, schema-design hints

