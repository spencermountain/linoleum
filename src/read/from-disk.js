// local-file byte source — same reader and analytics, no network
import { open } from './index.js'

const diskSource = async (path) => {
  const fs = await import('node:fs/promises') // lazy, so browser bundles never see it
  const fh = await fs.open(path, 'r')
  return {
    async read(start, end) {
      const buf = new Uint8Array(end - start + 1)
      const { bytesRead } = await fh.read(buf, 0, buf.length, start)
      return { bytes: buf.subarray(0, bytesRead) } // short read at eof, like a clamped 206
    },
    close: () => fh.close(),
  }
}

export const fromDisk = async (path, size, opts) => open(await diskSource(path), size, opts)
