import http from 'node:http'

// or serve it with range support, like s3 would, and read over http
const file = Buffer.from(bytes)
const server = http.createServer((req, res) => {
  const m = /bytes=(\d+)-(\d+)?/.exec(req.headers.range || '')
  if (!m) {
    res.writeHead(200)
    res.end(file)
    return
  }
  const start = +m[1]
  const end = Math.min(m[2] ? +m[2] : file.length - 1, file.length - 1)
  res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${file.length}` })
  res.end(file.subarray(start, end + 1))
})

await new Promise((ok) => server.listen(0, ok))
const db = await fromUrl(`http://localhost:${server.address().port}${path.slice(1)}`, size)
const matches = await db.get(query)
console.log(`\nsame ${matches.length} rows over http`)
console.log('url: ', db.stats())
server.close()