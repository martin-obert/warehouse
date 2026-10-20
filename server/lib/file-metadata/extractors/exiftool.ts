import { BinaryField, ExifDate, ExifDateTime, ExifTime, ExifTool, type ExifToolOptions } from 'exiftool-vendored'
import type { EmbeddedMetadata, JsonObject, JsonValue } from '../types'
import { toJson } from '../util'

let instance: ExifTool | undefined
let instanceOptions: Partial<ExifToolOptions> = { taskTimeoutMillis: 120_000 }

/** Used by configureFileMetadata({ exiftool }); must run before the first extraction. */
export function configureExifTool(options: Partial<ExifToolOptions>): void {
  if (instance) throw new Error('configureExifTool() must be called before the first extraction')
  instanceOptions = { ...instanceOptions, ...options }
}

/**
 * One shared pool of long-lived `exiftool -stay_open` processes. Spawning perl per file
 * would cost 100+ ms each; a warm process answers in ~10–30 ms.
 */
export function getExifTool(): ExifTool {
  instance ??= new ExifTool(instanceOptions)
  return instance
}

/** Call on shutdown (server/plugins/file-metadata.ts) so no perl processes outlive the server. */
export async function shutdownExifTool(): Promise<void> {
  const current = instance
  instance = undefined
  await current?.end()
}

// Tags that leak server paths, change on every call, or are reported elsewhere in the output.
const DROPPED_TAGS = new Set([
  'SourceFile', 'File:Directory', 'File:FilePath', 'File:BaseName',
  'ExifTool:Now', 'ExifTool:NewGUID', 'ExifTool:NewUUID', 'ExifTool:FileSequence', 'ExifTool:ProcessingTime',
  'ExifTool:Warning', 'ExifTool:Error', 'ExifTool:ExifToolVersion',
])
// Keys exiftool-vendored adds itself (unprefixed); surfaced as dedicated fields instead.
const LIBRARY_KEYS = new Set([
  'errors', 'warnings', 'tz', 'zone', 'tzSource', 'zoneSource', 'invalidUtf8Bytes',
  'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
])
const MAX_EMBEDDED_DOCUMENTS = 500

function normalizeValue(value: unknown): JsonValue | undefined {
  if (value instanceof ExifDateTime) return value.toISOString() ?? value.rawValue ?? null
  if (value instanceof ExifDate || value instanceof ExifTime) return value.toISOString()
  if (value instanceof BinaryField) return { binaryBytes: value.bytes }
  if (typeof value === 'string') {
    const binary = BinaryField.fromRawValue(value) // "(Binary data 1632 bytes, use -b option to extract)"
    return binary ? { binaryBytes: binary.bytes } : value
  }
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item) ?? null)
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      const normalized = normalizeValue(item)
      if (normalized !== undefined) out[key] = normalized
    }
    return out // XMP structures
  }
  return toJson(value)
}

/** "EXIF:Make" → groups.EXIF.Make */
function groupTags(tags: Record<string, unknown>): Record<string, JsonObject> {
  const groups: Record<string, JsonObject> = {}
  for (const [key, value] of Object.entries(tags)) {
    if (DROPPED_TAGS.has(key) || LIBRARY_KEYS.has(key)) continue
    const colon = key.indexOf(':')
    const group = colon > 0 ? key.slice(0, colon) : 'Other'
    const name = colon > 0 ? key.slice(colon + 1) : key
    const normalized = normalizeValue(value)
    if (normalized !== undefined) (groups[group] ??= {})[name] = normalized
  }
  return groups
}

/** Deep mode: -ee3 surfaces embedded documents (timed GPS/IMU samples, previews, sub-files). */
async function readEmbeddedDocuments(exiftool: ExifTool, path: string) {
  // -ee implies -a (duplicates), which only stays lossless when keys carry the document number (-G3).
  const raw = await exiftool.readRaw(path, { readArgs: ['-ee3', '-G3:1', '-n', '-api', 'largefilesupport=1'] })
  const documents: Record<string, JsonObject> = {}
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(raw)) {
    const match = /^(Doc\d+(?:-\d+)*):(.+)$/.exec(key)
    if (!match) continue
    const [, doc, name] = match as unknown as [string, string, string]
    if (!seen.has(doc)) {
      seen.add(doc)
      if (seen.size <= MAX_EMBEDDED_DOCUMENTS) documents[doc] = {}
    }
    const target = documents[doc]
    const normalized = normalizeValue(value)
    if (target && normalized !== undefined) target[name] = normalized
  }
  return { documents, total: seen.size }
}

export async function extractEmbedded(path: string, deep: boolean): Promise<EmbeddedMetadata> {
  const exiftool = getExifTool()
  // Fail fast with a clear message if the binary is missing; otherwise the task would just
  // sit in the queue until it times out.
  await exiftool.exiftoolPath()
  const [tags, embedded] = await Promise.all([
    exiftool.read(path, {
      groupNames: true, // "EXIF:Make" instead of an ambiguous "Make" (same tag in EXIF, XMP, MakerNotes…)
      geolocation: true, // offline reverse geocoding of GPS → city/region/country/timezone
      imageHashType: deep ? 'SHA256' : false, // hash of pixel data only: same image, different metadata → same hash
      // -fast skips scanning for trailers; deep reads everything, unknown tags and all System tags included.
      readArgs: deep
        ? ['-u', '-api', 'requestall=3', '-api', 'largefilesupport=1']
        : ['-fast', '-api', 'largefilesupport=1'],
    }),
    deep ? readEmbeddedDocuments(exiftool, path) : undefined,
  ])

  const bag = tags as Record<string, unknown>
  const latitude = bag.GPSLatitude
  const longitude = bag.GPSLongitude
  const version = bag['ExifTool:ExifToolVersion']

  const result: EmbeddedMetadata = {
    tool: { name: 'exiftool', version: typeof version === 'string' ? version : null },
    groups: groupTags(bag),
    gps: typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : null,
    timezone: tags.zone ? { zone: tags.zone, source: tags.zoneSource ?? null } : null,
    warnings: tags.warnings ?? [],
    errors: tags.errors ?? [],
  }
  if (embedded && embedded.total > 0) {
    result.embeddedDocuments = embedded.documents
    const kept = Object.keys(embedded.documents).length
    if (kept < embedded.total) result.embeddedDocumentsTruncated = { total: embedded.total, kept }
  }
  return result
}
