// growable binary writer + sequential reader (little-endian)
export class ByteWriter {
  constructor(size = 1024) {
    this.bytes = new Uint8Array(size)
    this.view = new DataView(this.bytes.buffer)
    this.pos = 0
  }
  ensure(n) {
    if (this.pos + n <= this.bytes.length) {
      return
    }
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.pos + n))
    grown.set(this.bytes)
    this.bytes = grown
    this.view = new DataView(grown.buffer)
  }
  u8(n) {
    this.ensure(1)
    this.view.setUint8(this.pos, n)
    this.pos += 1
  }
  u16(n) {
    this.ensure(2)
    this.view.setUint16(this.pos, n, true)
    this.pos += 2
  }
  u32(n) {
    this.ensure(4)
    this.view.setUint32(this.pos, n, true)
    this.pos += 4
  }
  f64(n) {
    this.ensure(8)
    this.view.setFloat64(this.pos, n, true)
    this.pos += 8
  }
  raw(bytes) {
    this.ensure(bytes.length)
    this.bytes.set(bytes, this.pos)
    this.pos += bytes.length
  }
  // unsigned LEB128 — arithmetic (not bitwise) so it stays safe past 2^32
  varint(n) {
    while (n >= 128) {
      this.u8((n % 128) + 128)
      n = Math.floor(n / 128)
    }
    this.u8(n)
  }
  // zigzag for signed values
  zigzag(n) {
    this.varint(n >= 0 ? n * 2 : -n * 2 - 1)
  }
  done() {
    return this.bytes.slice(0, this.pos)
  }
}

export class ByteReader {
  constructor(bytes) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.pos = 0
  }
  u8() {
    const n = this.view.getUint8(this.pos)
    this.pos += 1
    return n
  }
  u16() {
    const n = this.view.getUint16(this.pos, true)
    this.pos += 2
    return n
  }
  u32() {
    const n = this.view.getUint32(this.pos, true)
    this.pos += 4
    return n
  }
  f64() {
    const n = this.view.getFloat64(this.pos, true)
    this.pos += 8
    return n
  }
  raw(len) {
    const b = this.bytes.slice(this.pos, this.pos + len)
    this.pos += len
    return b
  }
  varint() {
    let n = 0
    let mult = 1
    while (true) {
      const byte = this.u8()
      n += (byte % 128) * mult
      if (byte < 128) {
        return n
      }
      mult *= 128
    }
  }
  zigzag() {
    const n = this.varint()
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2
  }
}
