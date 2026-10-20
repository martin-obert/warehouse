/**
 * Public types for the file-metadata library.
 *
 * Sections produced by this library use camelCase. "Foreign" sections keep the
 * native naming of the tool that produced them (ExifTool tags are PascalCase and
 * grouped, ffprobe fields are snake_case) so you can look them up in that tool's docs.
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512'] as const
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number]

/** The file to inspect. Build it with `resolveInsideRoot()` when the path comes from a client, or pass a plain path. */
export interface FileTarget {
  /** Canonical absolute path (symlinks resolved). This is the file that is read. */
  absolutePath: string
  /** Absolute path as requested, before symlink resolution. Used to report symlinks. */
  requestedPath?: string
  /** Path shown to clients instead of server paths, e.g. "photos/a.jpg". Defaults to the base name. */
  displayPath?: string
  /** Display path of the symlink target, when the requested path is a symlink. */
  resolvedDisplayPath?: string
}

export interface ExtractOptions {
  /**
   * Read the whole file: hashes, byte entropy, line statistics, ExifTool full scan with
   * unknown tags and embedded documents, image pixel statistics and perceptual hash,
   * ffprobe packet counts, exact audio duration, PDF text layer. Default: false.
   */
  deep?: boolean
  /** Hash algorithms computed in deep mode. Default: ['sha256']. */
  hashes?: readonly HashAlgorithm[]
  /** Whole-file passes (hashes, entropy, lines) are skipped above this size. Default: 4 GiB. */
  maxFullReadBytes?: number
  /** pdf.js needs the whole document in memory; PDFs above this size are skipped. Default: 256 MiB. */
  maxPdfBytes?: number
  /** Time budget per extractor. Default: 20 s, or 120 s in deep mode. */
  timeoutMs?: number
  /** ffprobe binary for this call. Default: configureFileMetadata({ ffprobePath }), else "ffprobe" from PATH. */
  ffprobePath?: string
}

export type ExtractorName =
  | 'filesystem'
  | 'contentType'
  | 'contentScan'
  | 'exiftool'
  | 'image'
  | 'media'
  | 'audio'
  | 'pdf'

export interface ExtractorReport {
  status: 'ok' | 'skipped' | 'failed' | 'timeout'
  ms?: number
  reason?: string
}

export interface PathInfo {
  display: string
  base: string
  name: string
  ext: string
  directory: string
  hidden: boolean
}

export interface Timestamp {
  iso: string
  /** Nanoseconds since the epoch, as a string (exceeds Number precision). */
  epochNs: string
}

export interface FilesystemInfo {
  type: 'file' | 'directory' | 'fifo' | 'socket' | 'block-device' | 'character-device' | 'unknown'
  size: number
  sizeHuman: string
  /** Bytes actually allocated on disk (st_blocks × 512). Null where the OS doesn't report blocks. */
  allocatedBytes: number | null
  /** Allocated < size: a sparse file, or a transparently compressed filesystem. */
  sparse: boolean | null
  blockSize: number | null
  permissions: { octal: string; symbolic: string; setuid: boolean; setgid: boolean; sticky: boolean }
  owner: { uid: number; gid: number }
  inode: string
  device: string
  hardLinks: number
  times: { modified: Timestamp; accessed: Timestamp; changed: Timestamp; born: Timestamp | null }
  /** Set when the requested path is a symlink; `target` is relative to the storage root. */
  symlink: { target: string } | null
  /** What *this server process* may do with the file. */
  access: { readable: boolean; writable: boolean; executable: boolean }
}

export type TextEncoding = 'ascii' | 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be' | 'unknown-8bit'

export interface TextSniff {
  isText: boolean
  encoding: TextEncoding | null
  bom: boolean
  sampledBytes: number
}

export interface ContentTypeInfo {
  /** Best guess: magic bytes first, then a text sniff, then the extension. */
  mime: string
  source: 'magic-bytes' | 'extension' | 'text-sniff' | 'fallback'
  byContent: { mime: string; ext: string } | null
  byExtension: { mime: string; ext: string } | null
  /** false = the extension lies about the content (renamed or spoofed file). null = can't tell. */
  extensionMatchesContent: boolean | null
  /** Only for files without a binary signature. */
  text: TextSniff | null
}

export interface ContentScanInfo {
  bytesRead: number
  hashes: Partial<Record<HashAlgorithm, string>>
  /** Shannon entropy in bits per byte (0–8). ≳7.9 usually means compressed or encrypted data. */
  byteEntropy: number
  text: {
    lines: number
    lineEndings: 'none' | 'lf' | 'crlf' | 'cr' | 'mixed'
    longestLineBytes: number
    trailingNewline: boolean
  } | null
}

export interface EmbeddedMetadata {
  tool: { name: 'exiftool'; version: string | null }
  /** ExifTool tags by family-0 group, e.g. { EXIF: { Make: "Canon" }, XMP: {...}, QuickTime: {...} }. */
  groups: Record<string, JsonObject>
  /** Signed decimal degrees, validated by exiftool-vendored. */
  gps: { latitude: number; longitude: number } | null
  /** Timezone of the capture dates, as inferred by exiftool-vendored. */
  timezone: { zone: string; source: string | null } | null
  /** Deep mode: embedded documents (timed GPS/sensor samples in videos, previews, …), keyed by document. */
  embeddedDocuments?: Record<string, JsonObject>
  embeddedDocumentsTruncated?: { total: number; kept: number }
  warnings: string[]
  errors: string[]
}

export interface ImageInfo {
  decoder: string
  mediaType: string | null
  width: number
  height: number
  /** Dimensions after applying EXIF orientation. */
  displayWidth: number
  displayHeight: number
  orientation: number | null
  colorSpace: string
  channels: number
  bitDepth: string
  bitsPerSample: number | null
  hasAlpha: boolean
  hasIccProfile: boolean
  isProgressive: boolean
  isPalette: boolean
  density: number | null
  resolutionUnit: string | null
  chromaSubsampling: string | null
  compression: string | null
  pages: number
  animated: boolean
  loop: number | null
  frameDelaysMs: number[] | null
  comments: { keyword: string; text: string }[]
  /** Sizes in bytes of embedded metadata blocks. */
  embeddedBlocks: { exif?: number; icc?: number; iptc?: number; xmp?: number; photoshop?: number; gainMap?: number }
  stats?: {
    isOpaque: boolean
    entropy: number
    sharpness: number
    dominantColor: string
    channels: { min: number; max: number; mean: number; stdev: number }[]
  }
  /** 64-bit difference hash (dHash) for near-duplicate detection; compare by Hamming distance. */
  perceptualHash?: string
}

export interface MediaInfo {
  container: JsonObject
  streams: JsonObject[]
  chapters: JsonObject[]
  programs: JsonObject[]
}

export interface AudioInfo {
  format: JsonObject
  /** Tags normalized across ID3, Vorbis, APE, iTunes, ASF… */
  common: JsonObject
  tagTypes: string[]
  pictures: { format: string; type: string | null; description: string | null; bytes: number }[]
  warnings: string[]
}

export interface PdfPageSize {
  widthPt: number
  heightPt: number
  widthMm: number
  heightMm: number
  paper: string | null
  orientation: 'portrait' | 'landscape' | 'square'
}

export interface PdfInfo {
  pages: number
  version: string | null
  /** Document information dictionary (Title, Author, Producer, dates…). */
  info: JsonObject
  /** XMP packet, flattened by pdf.js. */
  xmp: JsonObject | null
  /** The trailer /ID pair: stable identifiers of the document and of this revision. */
  fingerprints: string[]
  firstPage: PdfPageSize & { rotation: number }
  linearized: boolean
  encrypted: boolean
  permissions: string[] | null
  tagged: boolean | null
  forms: { acroForm: boolean; xfa: boolean; fieldCount: number }
  javascript: boolean
  signatures: JsonObject[]
  attachments: { name: string; bytes: number | null; description: string | null }[]
  outlineItems: number
  pageLabels: boolean
  pageLayout: string | null
  pageMode: string | null
  /** Deep mode only. */
  text?: { characters: number; pagesWithText: number; excerpt: string }
  /** Deep mode only: distinct page sizes and how many pages have each. */
  pageSizes?: (PdfPageSize & { count: number })[]
}

export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'text'
  | 'archive'
  | 'font'
  | 'executable'
  | 'empty'
  | 'other'

/** Normalized cross-format view, derived from all sections. */
export interface Summary {
  name: string
  kind: FileKind
  mime: string
  size: number
  sizeHuman: string
  modifiedAt: string
  extensionMismatch: boolean
  createdAt?: string
  title?: string
  author?: string
  description?: string
  keywords?: string[]
  software?: string
  camera?: string
  lens?: string
  width?: number
  height?: number
  durationSeconds?: number
  pages?: number
  codecs?: string[]
  gps?: { latitude: number; longitude: number; altitude?: number }
  location?: string
  sha256?: string
}

export interface FileMetadata {
  path: PathInfo
  summary: Summary
  filesystem: FilesystemInfo
  contentType: ContentTypeInfo
  content?: ContentScanInfo
  embedded?: EmbeddedMetadata
  image?: ImageInfo
  media?: MediaInfo
  audio?: AudioInfo
  pdf?: PdfInfo
  extraction: {
    deep: boolean
    startedAt: string
    durationMs: number
    extractors: Partial<Record<ExtractorName, ExtractorReport>>
  }
}
