import { makeFile, readFile } from './src/index.js'
import fs from 'fs'

// ahead of time (node)
const lino = makeFile()
lino.schema([
  { id: 'city', type: 'string' }, // schema order = sort order = index priority
  { id: 'temp', type: 'number' },
  { id: 'note', type: 'string', index: false }, // extra payload, not queryable-efficiently
])
lino.rows([
  { city: 'detroit', temp: 15, node: 'cool' },
  { city: 'baltimore', temp: 25, node: 'cool' },
  { city: 'denver', temp: 35, node: 'denvercool' },
  { city: 'tokyo', temp: 5, node: 'tokyocool' },
])
const bytes = await lino.burn('md')
fs.writeFileSync('data-md.lino', bytes)
console.log(lino.report) // chunks, index headroom, suggested size

// on the hot path (browser or node)
// const db = await readFile(url, 'md') // one blind range request for the index
// const matches = await db.get({ city: 'denver', temp: { $gte: 20 } })
// console.log(matches)
// console.log(db.stats()) // bytes fetched, chunks skipped, schema-design hints