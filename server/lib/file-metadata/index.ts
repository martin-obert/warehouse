/**
 * File metadata extraction for a Node.js server. Framework-agnostic: works from any Nuxt/Nitro
 * route, upload hook, task or queue worker.
 *
 *   import { extractFileMetadata, resolveInsideRoot } from '#server/lib/file-metadata'
 *
 *   const meta = await extractFileMetadata('/srv/files/photo.jpg')           // trusted server path
 *   const file = await resolveInsideRoot('/srv/files', pathFromClient)        // untrusted path → safe target
 *   const full = await extractFileMetadata(file, { deep: true, hashes: ['sha256', 'md5'] })
 *
 * Layers, cheapest first; each one is isolated (own timeout, a failure doesn't sink the rest):
 *   filesystem   fs.stat/lstat/access          size, times (ns), mode, owner, inode, sparse, symlink
 *   contentType  file-type + mime + sniffing   real type from magic bytes, spoofed-extension check, encoding
 *   contentScan  one streaming pass (deep)     sha256/…, byte entropy, line count & endings
 *   exiftool     exiftool-vendored             EXIF/IPTC/XMP/ICC/MakerNotes, QuickTime, ID3, PDF, Office, fonts, GPS + geolocation
 *   image        sharp (libvips)               decoded geometry, colour, alpha, animation; deep: pixel stats, dHash
 *   media        ffprobe                       streams, codecs, HDR/colour, chapters, rotation
 *   audio        music-metadata                normalized tags across ID3/Vorbis/APE/MP4, cover art
 *   pdf          unpdf (pdf.js)                pages, paper size, permissions, forms, JS, signatures, attachments, text layer
 *
 * Requirements
 *   npm i exiftool-vendored file-type mime music-metadata sharp unpdf      (Node 22+)
 *   Perl on Linux/macOS (bundled on Windows) + Archive::Zip for Office/ODF/EPUB properties:
 *     Debian/Ubuntu `apt install libarchive-zip-perl` · Alpine `apk add perl perl-archive-zip`
 *   ffprobe (FFmpeg) on PATH, or configureFileMetadata({ ffprobePath })
 *   Nuxt: modules/exiftool-vendored.ts ships ExifTool in .output;
 *         server/plugins/file-metadata.ts stops ExifTool on shutdown and dev reloads.
 */
import { realpath } from 'node:fs/promises'
import { basename, posix, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { ExifToolOptions } from 'exiftool-vendored'
import { scanContent } from './extractors/content-scan'
import { extractContentType } from './extractors/content-type'
import { configureExifTool, extractEmbedded } from './extractors/exiftool'
import { extractFilesystem } from './extractors/filesystem'
import { extractMedia } from './extractors/media'
import { buildSummary } from './summary'
import type { ContentTypeInfo, ExtractOptions, ExtractorName, FileMetadata, FileTarget, HashAlgorithm, PathInfo } from './types'
import { SkipExtractor, errorMessage, humanBytes, toJson } from './util'

export * from './types'
export { PathAccessError, resolveInsideRoot } from './safe-path'
export { shutdownExifTool } from './extractors/exiftool'

export interface ExtractionThumbnail {
  data: Buffer
  width: number
  height: number
}

export interface FileMetadataResult {
  metadata: FileMetadata
  thumbnail: ExtractionThumbnail | null
}

export class NotAFileError extends Error {
  override name = 'NotAFileError'
}

class TimeoutError extends Error {}

export interface FileMetadataConfig {
  /** Extractions running at once in this process; further calls wait in a queue. Default: 4. */
  maxConcurrent?: number
  /** Default ffprobe binary. Default: "ffprobe" from PATH. */
  ffprobePath?: string
  /** Options for the shared ExifTool process pool, e.g. { exiftoolPath: '/usr/bin/exiftool', maxProcs: 2 }. */
  exiftool?: Partial<ExifToolOptions>
}

const config = { maxConcurrent: 4, ffprobePath: 'ffprobe' }

/** Optional process-wide settings. Call once at startup (e.g. in a Nitro plugin), before the first extraction. */
export function configureFileMetadata(options: FileMetadataConfig): void {
  if (options.maxConcurrent !== undefined) config.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent))
  if (options.ffprobePath) config.ffprobePath = options.ffprobePath
  if (options.exiftool) configureExifTool(options.exiftool)
}

// Bounded concurrency: a burst of calls queues up instead of forking dozens of ffprobe
// processes and holding many decoded images / PDFs in memory at once.
let active = 0
const waiting: (() => void)[] = []

async function acquireSlot(): Promise<void> {
  if (active < config.maxConcurrent) {
    active++
    return
  }
  await new Promise<void>((wake) => waiting.push(wake)) // releaseSlot() hands its slot over directly
}

function releaseSlot(): void {
  const next = waiting.shift()
  if (next) next()
  else active--
}

const MiB = 1024 ** 2
const GiB = 1024 ** 3
const EXTRACTOR_ORDER: ExtractorName[] = ['filesystem', 'contentType', 'contentScan', 'exiftool', 'image', 'media', 'audio', 'pdf']

function resolveOptions(options: ExtractOptions) {
  const deep = options.deep ?? false
  return {
    deep,
    hashes: (options.hashes?.length ? [...new Set(options.hashes)] : ['sha256']) as HashAlgorithm[],
    maxFullReadBytes: options.maxFullReadBytes ?? 4 * GiB,
    maxPdfBytes: options.maxPdfBytes ?? 64 * MiB,
    timeoutMs: options.timeoutMs ?? (deep ? 120_000 : 20_000),
    ffprobePath: options.ffprobePath ?? config.ffprobePath,
    withThumbnail: options.withThumbnail ?? false,
  }
}

type ResolvedOptions = ReturnType<typeof resolveOptions>

const UNKNOWN_TYPE: ContentTypeInfo = {
  mime: 'application/octet-stream',
  source: 'fallback',
  byContent: null,
  byExtension: null,
  extensionMatchesContent: null,
  text: null,
}

/** A plain path is resolved and followed through symlinks, like resolveInsideRoot() does. */
async function toTarget(input: string | FileTarget): Promise<FileTarget> {
  if (typeof input !== 'string') return { ...input, absolutePath: resolve(input.absolutePath) }
  const requestedPath = resolve(input)
  const absolutePath = await realpath(requestedPath)
  return { absolutePath, requestedPath, displayPath: basename(requestedPath), resolvedDisplayPath: basename(absolutePath) }
}

/**
 * Everything knowable about one file, as plain JSON. A failing or missing tool never makes this
 * throw — see `extraction.extractors` for each layer's status. It throws only when the file can't
 * be stat'ed (ENOENT, EACCES…) or isn't a regular file (NotAFileError).
 */
export async function extractFileMetadata(input: string | FileTarget, options: ExtractOptions = {}): Promise<FileMetadataResult> {
  await acquireSlot()
  try {
    return await extract(await toTarget(input), resolveOptions(options))
  } finally {
    releaseSlot()
  }
}

async function extract(target: FileTarget, options: ResolvedOptions): Promise<FileMetadataResult> {
  const path = target.absolutePath
  const display = target.displayPath ?? basename(target.requestedPath ?? path)
  const extractors: FileMetadata['extraction']['extractors'] = {}
  const startedAt = new Date().toISOString()
  const t0 = performance.now()

  /** Run one extractor with a time budget; record ok / skipped / failed / timeout instead of throwing. */
  async function run<T>(name: ExtractorName, gate: true | string, task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (gate !== true) {
      extractors[name] = { status: 'skipped', reason: gate }
      return undefined
    }
    const controller = new AbortController()
    const started = performance.now()
    const ms = () => Math.round(performance.now() - started)
    let timer: NodeJS.Timeout | undefined
    try {
      const value = await Promise.race([
        task(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort() // stops streams, file-type and ffprobe; others finish in the background
            reject(new TimeoutError())
          }, options.timeoutMs)
        }),
      ])
      extractors[name] = { status: 'ok', ms: ms() }
      return value
    } catch (error) {
      extractors[name] =
        error instanceof TimeoutError
          ? { status: 'timeout', ms: ms(), reason: `exceeded ${options.timeoutMs} ms` }
          : error instanceof SkipExtractor
            ? { status: 'skipped', reason: error.message }
            : { status: 'failed', ms: ms(), reason: errorMessage(error) }
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  // Phase 1 — cheap and required: everything else is gated on size and real type.
  const fsStarted = performance.now()
  const filesystem = await extractFilesystem(target)
  extractors.filesystem = { status: 'ok', ms: Math.round(performance.now() - fsStarted) }
  if (filesystem.type !== 'file') throw new NotAFileError(`${display} is a ${filesystem.type}, not a regular file`)

  const contentType = (await run('contentType', true, (signal) => extractContentType(path, filesystem.size, signal))) ?? UNKNOWN_TYPE
  const { mime } = contentType
  const { size } = filesystem
  const nonEmpty = size > 0 || 'empty file'

  // Phase 2 — independent extractors in parallel. Heavy dependencies load lazily on first use.
  const [content, embedded, imageResult, media, audio, pdf] = await Promise.all([
    run(
      'contentScan',
      !options.deep ? 'deep mode only' : size > options.maxFullReadBytes ? `larger than maxFullReadBytes (${humanBytes(options.maxFullReadBytes)})` : true,
      (signal) => scanContent(path, { algorithms: options.hashes, textEncoding: contentType.text?.encoding ?? null, signal }),
    ),
    run('exiftool', nonEmpty, () => extractEmbedded(path, options.deep)),
    run('image', mime.startsWith('image/') ? nonEmpty : 'not an image', async () =>
      (await import('./extractors/image')).extractImage(path, mime, options.deep, { withThumbnail: options.withThumbnail }),
    ),
    run('media', /^(audio|video)\//.test(mime) ? nonEmpty : 'not audio/video', (signal) =>
      extractMedia(path, { ffprobePath: options.ffprobePath, deep: options.deep, signal, timeoutMs: options.timeoutMs }),
    ),
    run('audio', mime.startsWith('audio/') ? nonEmpty : 'not audio', async () =>
      (await import('./extractors/audio')).extractAudio(path, options.deep),
    ),
    run(
      'pdf',
      mime !== 'application/pdf' ? 'not a PDF' : size > options.maxPdfBytes ? `larger than maxPdfBytes (${humanBytes(options.maxPdfBytes)})` : nonEmpty,
      async () => (await import('./extractors/pdf')).extractPdf(path, options.deep),
    ),
  ])

  const base = posix.basename(display)
  const ext = posix.extname(base)
  const directory = posix.dirname(display)
  const pathInfo: PathInfo = {
    display,
    base,
    name: ext ? base.slice(0, -ext.length) : base,
    ext: ext.toLowerCase(),
    directory: directory === '.' ? '' : directory,
    hidden: base.startsWith('.'),
  }

  const image = imageResult?.info
  const thumbnail = imageResult?.thumbnail ?? null
  const sections = { path: pathInfo, filesystem, contentType, content, embedded, image, media, audio, pdf }
  const result: FileMetadata = {
    path: pathInfo,
    summary: buildSummary(sections),
    filesystem,
    contentType,
    ...(content && { content }),
    ...(embedded && { embedded }),
    ...(image && { image }),
    ...(media && { media }),
    ...(audio && { audio }),
    ...(pdf && { pdf }),
    extraction: {
      deep: options.deep,
      startedAt,
      durationMs: Math.round(performance.now() - t0),
      extractors: Object.fromEntries(EXTRACTOR_ORDER.filter((name) => extractors[name]).map((name) => [name, extractors[name]])),
    },
  }

  // Final guard: plain serializable JSON, and no absolute server paths anywhere — tool errors and
  // warnings often quote the path they were given. Longest first, so one can't mangle the other.
  let json = JSON.stringify(toJson(result))
  const escaped = (text: string) => JSON.stringify(text).slice(1, -1)
  const serverPaths = [...new Set([path, target.requestedPath ?? path])].sort((a, b) => b.length - a.length)
  for (const serverPath of serverPaths) json = json.split(escaped(serverPath)).join(escaped(display))
  return { metadata: JSON.parse(json) as FileMetadata, thumbnail }
}
