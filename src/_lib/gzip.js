// native gzip via web streams — node 18+ and all modern browsers, zero deps
const pipe = async (bytes, stream) => {
  const out = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'))
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream('gzip'))
