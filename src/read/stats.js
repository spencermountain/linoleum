// download analytics for one reader — the schema-design feedback loop
export const makeStats = () => ({
  requests: 0,
  bytesFetched: 0,
  chunksFetched: 0,
  gets: 0,
  chunksTotal: 0,
  fileBytes: 0,
  hints: new Set(),
  hint(msg) {
    this.hints.add(msg)
  },
  summary() {
    const pct = this.fileBytes ? Math.round((this.bytesFetched / this.fileBytes) * 1000) / 10 : 0
    return {
      requests: this.requests,
      bytesFetched: this.bytesFetched,
      fileBytes: this.fileBytes,
      pctFetched: pct,
      gets: this.gets,
      chunksFetched: this.chunksFetched,
      chunksTotal: this.chunksTotal,
      hints: [...this.hints],
    }
  },
})
