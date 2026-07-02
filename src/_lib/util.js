// shared helpers — comparison, utf8, byte wrangling
const enc = new TextEncoder()
const dec = new TextDecoder()

export const toUtf8 = (str) => enc.encode(str)
export const fromUtf8 = (bytes) => dec.decode(bytes)

// type-aware compare; nulls sort last
export const cmp = (a, b) => {
  if (a === b) {
    return 0
  }
  if (a === null || a === undefined) {
    return 1
  }
  if (b === null || b === undefined) {
    return -1
  }
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

// first n utf8 bytes of a string (may split a codepoint — only ever byte-compared)
export const utf8Prefix = (str, n) => enc.encode(str).slice(0, n)

// byte-wise lexicographic compare of two Uint8Arrays
export const cmpBytes = (a, b) => {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1
    }
  }
  if (a.length === b.length) {
    return 0
  }
  return a.length < b.length ? -1 : 1
}

// drop zero-padding added when prefixes were stored at fixed width
export const trimZeros = (bytes) => {
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) {
    end -= 1
  }
  return bytes.slice(0, end)
}

export const concatBytes = (arrays) => {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const a of arrays) {
    out.set(a, pos)
    pos += a.length
  }
  return out
}
