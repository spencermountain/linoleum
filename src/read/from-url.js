// network byte source — fetch with range headers, s3/cdn friendly
import { open } from './index.js'

const urlSource = (url) => ({
  async read(start, end) {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
    if (!res.ok) {
      throw new Error(`fetch failed (${res.status}) for ${url}`)
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    return { bytes, whole: res.status === 200 } // 200 = server ignored the range
  },
})

export const fromUrl = (url, size, opts) => open(urlSource(url), size, opts)
