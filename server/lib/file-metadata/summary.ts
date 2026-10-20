import { isTextualMime } from './extractors/content-type'
import type { FileKind, FileMetadata, JsonObject, JsonValue, Summary } from './types'

type Sections = Omit<FileMetadata, 'summary' | 'extraction'>

function kindOf(mime: string, size: number): FileKind {
  if (size === 0) return 'empty'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('font/') || /font-(ttf|otf|woff)|x-font/.test(mime)) return 'font'
  if (/wordprocessingml|msword|opendocument\.text|rtf|epub\+zip/.test(mime)) return 'document'
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(mime)) return 'spreadsheet'
  if (/presentationml|ms-powerpoint|opendocument\.presentation/.test(mime)) return 'presentation'
  if (/zip|x-tar|gzip|x-7z|x-rar|vnd\.rar|x-bzip2|x-xz|zstd|x-lzip|x-lzma|x-cpio|x-iso9660|java-archive|android\.package/.test(mime)) return 'archive'
  if (/x-elf|x-msdownload|x-mach-binary|portable-executable|x-executable|x-sharedlib|wasm/.test(mime)) return 'executable'
  if (isTextualMime(mime)) return 'text'
  return 'other'
}

const present = (v: JsonValue | undefined): v is JsonValue =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

/** First non-empty ExifTool value among "Group:Tag" keys, in priority order. */
function tag(groups: Record<string, JsonObject>, ...keys: string[]): JsonValue | undefined {
  for (const key of keys) {
    const colon = key.indexOf(':')
    const value = groups[key.slice(0, colon)]?.[key.slice(colon + 1)]
    if (present(value)) return value
  }
  return undefined
}

function text(...values: (JsonValue | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
    if (Array.isArray(value)) {
      const joined = value.filter((v) => typeof v === 'string' || typeof v === 'number').join(', ')
      if (joined) return joined
    }
  }
  return undefined
}

const num = (...values: (JsonValue | undefined)[]) =>
  values.find((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)

// ISO strings produced by the ExifTool normalizer, ffprobe or pdf.js; rejects "0000:00:00 00:00:00".
const date = (...values: (JsonValue | undefined)[]) =>
  values.find((v): v is string => typeof v === 'string' && /^(19|20)\d\d-\d\d-\d\d/.test(v))

/** A normalized, cross-format view. Every field is derived from the detailed sections. */
export function buildSummary(s: Sections): Summary {
  const g = s.embedded?.groups ?? {}
  const containerTags = (s.media?.container.tags ?? {}) as JsonObject
  const common = s.audio?.common ?? {}
  const visualStreams = (s.media?.streams ?? []).filter(
    (st) => st.codec_type === 'video' && !(Array.isArray(st.disposition) && st.disposition.includes('attached_pic')),
  )
  const video = visualStreams[0]

  const imageSize = text(tag(g, 'Composite:ImageSize'))?.match(/^(\d+)x(\d+)$/)
  const make = text(tag(g, 'EXIF:Make', 'QuickTime:Make', 'XMP:Make'))
  const model = text(tag(g, 'EXIF:Model', 'QuickTime:Model', 'XMP:Model'))
  const keywordsValue = tag(g, 'XML:Keywords', 'PDF:Keywords', 'Composite:Keywords', 'XMP:Subject', 'IPTC:Keywords', 'QuickTime:Keywords')
  const keywords = (Array.isArray(keywordsValue) ? keywordsValue.map(String) : typeof keywordsValue === 'string' ? keywordsValue.split(/[,;]/) : [])
    .map((k) => k.trim())
    .filter(Boolean)
  const altitude = num(tag(g, 'Composite:GPSAltitude', 'EXIF:GPSAltitude', 'XMP:GPSAltitude'))
  const location = [...new Set(['ExifTool:GeolocationCity', 'ExifTool:GeolocationRegion', 'ExifTool:GeolocationCountry'].map((k) => text(tag(g, k))).filter(Boolean))]
  const codecs = [
    ...new Set(
      (s.media?.streams ?? [])
        .filter((st) => ['video', 'audio', 'subtitle'].includes(String(st.codec_type)))
        .filter((st) => !(Array.isArray(st.disposition) && st.disposition.includes('attached_pic')))
        .map((st) => st.codec_name)
        .filter((codec): codec is string => typeof codec === 'string'),
    ),
  ]

  const summary: Summary = {
    name: s.path.base,
    kind: kindOf(s.contentType.mime, s.filesystem.size),
    mime: s.contentType.mime,
    size: s.filesystem.size,
    sizeHuman: s.filesystem.sizeHuman,
    modifiedAt: s.filesystem.times.modified.iso,
    extensionMismatch: s.contentType.extensionMatchesContent === false,
    createdAt: date(
      tag(g, 'Composite:SubSecDateTimeOriginal', 'Composite:DateTimeOriginal', 'EXIF:DateTimeOriginal', 'XMP:DateTimeOriginal'),
      tag(g, 'Composite:SubSecCreateDate', 'EXIF:CreateDate', 'XMP:CreateDate', 'QuickTime:CreationDate', 'QuickTime:CreateDate'),
      tag(g, 'Matroska:DateTimeOriginal', 'RIFF:DateTimeOriginal', 'PDF:CreateDate', 'XML:CreateDate', 'FlashPix:CreateDate', 'PNG:CreationTime'),
      containerTags.creation_time,
      s.pdf?.info.CreationDate,
    ),
    title: text(
      s.pdf?.info.Title,
      common.title,
      tag(g, 'XMP:Title', 'QuickTime:Title', 'Matroska:Title', 'ID3:Title', 'Vorbis:Title', 'APE:Title', 'ASF:Title', 'RIFF:Title'),
      tag(g, 'PNG:Title', 'IPTC:ObjectName', 'PDF:Title', 'XML:Title', 'FlashPix:Title', 'Font:FontName'),
      containerTags.title,
    ),
    author: text(
      tag(g, 'Composite:Creator', 'XMP:Creator', 'EXIF:Artist', 'IPTC:By-line', 'PDF:Author', 'XML:Creator'),
      common.artist,
      tag(g, 'QuickTime:Artist', 'QuickTime:Author', 'ID3:Artist', 'Vorbis:Artist', 'PNG:Author', 'Font:Manufacturer'),
      containerTags.artist,
    ),
    description: text(
      tag(g, 'Composite:Description', 'XMP:Description', 'EXIF:ImageDescription', 'IPTC:Caption-Abstract', 'PDF:Subject'),
      tag(g, 'QuickTime:Description', 'QuickTime:Comment', 'PNG:Description', 'ID3:Comment', 'Vorbis:Comment'),
      containerTags.description,
      containerTags.comment,
    ),
    keywords: keywords.length ? [...new Set(keywords)] : undefined,
    software: text(
      tag(g, 'EXIF:Software', 'XMP:CreatorTool', 'XML:Application', 'PDF:Creator', 'PDF:Producer', 'PNG:Software'),
      tag(g, 'QuickTime:Software', 'QuickTime:Encoder', 'Matroska:WritingApp', 'RIFF:Software', 'ID3:EncoderSettings'),
      containerTags.encoder,
    ),
    camera: make && model ? (model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`) : (model ?? make),
    lens: text(tag(g, 'Composite:LensID', 'EXIF:LensModel', 'Composite:Lens', 'XMP:LensModel', 'XMP:Lens')),
    width: num(s.image?.displayWidth, video?.displayWidth, imageSize ? Number(imageSize[1]) : undefined),
    height: num(s.image?.displayHeight, video?.displayHeight, imageSize ? Number(imageSize[2]) : undefined),
    durationSeconds: num(
      s.media?.container.duration,
      s.audio?.format.duration,
      tag(g, 'Composite:Duration', 'QuickTime:Duration', 'Matroska:Duration', 'RIFF:Duration', 'GIF:Duration'),
    ),
    pages: num(s.pdf?.pages, tag(g, 'PDF:PageCount', 'XML:Pages', 'XML:Slides')),
    codecs: codecs.length ? codecs : undefined,
    gps: s.embedded?.gps ? { ...s.embedded.gps, ...(altitude !== undefined ? { altitude } : {}) } : undefined,
    location: location.length ? location.join(', ') : undefined,
    sha256: s.content?.hashes.sha256,
  }
  // Keep the summary compact: drop fields that couldn't be derived.
  for (const key of Object.keys(summary) as (keyof Summary)[]) if (summary[key] === undefined) delete summary[key]
  return summary
}
