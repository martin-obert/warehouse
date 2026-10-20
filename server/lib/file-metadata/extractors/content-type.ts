import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileTypeFromFile } from 'file-type'
import mime from 'mime'
import type { ContentTypeInfo, TextEncoding, TextSniff } from '../types'

const SNIFF_BYTES = 64 * 1024

const TEXTUAL_MIME =
  /^text\/|^image\/svg\+xml$|[+/](json|xml|yaml|toml)$|^application\/(javascript|ecmascript|x-sh|x-shellscript|x-ndjson|sql|graphql|x-httpd-php|x-subrip|x-tex|rtf)$/

export const isTextualMime = (type: string) => TEXTUAL_MIME.test(type)

async function readHead(path: string, bytes: number): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const startsWith = (data: Uint8Array, ...bytes: number[]) => bytes.every((byte, i) => data[i] === byte)

/** Decide text vs. binary from a sample: BOMs, NUL bytes, strict UTF-8 validation, control-char ratio. */
export function sniffText(sample: Uint8Array, truncated: boolean): TextSniff {
  const result = (isText: boolean, encoding: TextEncoding | null, bom = false): TextSniff => ({
    isText,
    encoding,
    bom,
    sampledBytes: sample.length,
  })
  if (startsWith(sample, 0xef, 0xbb, 0xbf)) return result(true, 'utf-8', true)
  if (startsWith(sample, 0xff, 0xfe, 0x00, 0x00)) return result(true, 'utf-32le', true)
  if (startsWith(sample, 0x00, 0x00, 0xfe, 0xff)) return result(true, 'utf-32be', true)
  if (startsWith(sample, 0xff, 0xfe)) return result(true, 'utf-16le', true)
  if (startsWith(sample, 0xfe, 0xff)) return result(true, 'utf-16be', true)
  if (sample.includes(0)) return result(false, null)
  try {
    // stream: true tolerates a multi-byte character cut off at the end of a truncated sample.
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: truncated })
    return result(true, sample.every((byte) => byte < 0x80) ? 'ascii' : 'utf-8')
  } catch {
    // Not UTF-8: legacy 8-bit text (windows-1250, latin-1, …) or binary.
    let control = 0
    for (const byte of sample) if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d && byte !== 0x1b) control++
    return control / sample.length < 0.01 ? result(true, 'unknown-8bit') : result(false, null)
  }
}

function extensionMatches(ext: string, byContent: { mime: string; ext: string }, extMime: string | null): boolean {
  return ext === byContent.ext || extMime === byContent.mime || (mime.getAllExtensions(byContent.mime)?.has(ext) ?? false)
}

/**
 * Real type from magic bytes (file-type reads only what its detectors need),
 * cross-checked against the extension. file-type only knows binary formats, so
 * files without a signature get a text sniff instead.
 */
export async function extractContentType(path: string, size: number, signal: AbortSignal): Promise<ContentTypeInfo> {
  const ext = extname(path).slice(1).toLowerCase()
  const extMime = ext ? mime.getType(ext) : null
  const byExtension = extMime ? { mime: extMime, ext } : null

  if (size === 0) {
    return { mime: 'application/x-empty', source: 'fallback', byContent: null, byExtension, extensionMatchesContent: null, text: null }
  }

  const detected = await fileTypeFromFile(path, { signal, maxBufferSize: 8 * 1024 * 1024, mpegOffsetTolerance: 10 })
  if (detected) {
    const byContent = { mime: detected.mime, ext: detected.ext }
    return {
      mime: detected.mime,
      source: 'magic-bytes',
      byContent,
      byExtension,
      extensionMatchesContent: ext ? extensionMatches(ext, byContent, extMime) : null,
      text: null,
    }
  }

  const text = sniffText(await readHead(path, SNIFF_BYTES), size > SNIFF_BYTES)
  if (text.isText) {
    // A text file named *.mp4 is *not* a video: content wins over the extension.
    const textualExtension = extMime !== null && isTextualMime(extMime)
    return {
      mime: textualExtension ? extMime : 'text/plain',
      source: textualExtension ? 'extension' : 'text-sniff',
      byContent: null,
      byExtension,
      extensionMatchesContent: extMime === null ? null : textualExtension,
      text,
    }
  }

  // Binary without a known signature: the extension is the only hint left.
  const plausible = extMime !== null && !isTextualMime(extMime)
  return {
    mime: plausible ? extMime : 'application/octet-stream',
    source: plausible ? 'extension' : 'fallback',
    byContent: null,
    byExtension,
    extensionMatchesContent: extMime === null ? null : plausible ? null : false,
    text,
  }
}
