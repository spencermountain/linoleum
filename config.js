// tunable knobs for building + reading .lino files
export default {
  // fixed index region sizes — the reader must know which one a file uses
  indexSizes: { sm: 16 * 1024, md: 64 * 1024, lg: 256 * 1024, xl: 1024 * 1024 },
  minChunkRows: 200, // floor on rows per chunk — tiny chunks waste requests
  stringPrefixLen: 8, // utf8 bytes stored per string min/max in the index
  dictMaxRatio: 0.5, // dictionary-encode a string column when uniques/rows is below this
  maxGapBytes: 4096, // merge two chunk fetches into one request when the gap between them is under this
  gzip: true, // gzip each chunk with the native CompressionStream
}
