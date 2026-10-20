import { parseFile } from 'music-metadata'
import type { AudioInfo, JsonObject } from '../types'
import { pruneEmpty, toJsonObject } from '../util'

/**
 * music-metadata maps ID3v1/v2, Vorbis, APE, iTunes/MP4, ASF, RIFF INFO… onto one
 * `common` shape (title, artist, album, track, ReplayGain, MusicBrainz IDs, …).
 * ExifTool has the raw tags; this is the normalized view.
 */
export async function extractAudio(path: string, deep: boolean): Promise<AudioInfo> {
  const metadata = await parseFile(path, {
    duration: deep, // exact duration for VBR files without a Xing/VBRI header requires a full scan
    skipCovers: false,
    includeChapters: true,
  })
  const { picture, ...common } = metadata.common
  const { audioMD5, trackInfo: _trackInfo, tagTypes: _tagTypes, ...format } = metadata.format

  return {
    format: pruneEmpty(toJsonObject({ ...format, audioMD5: audioMD5 ? Buffer.from(audioMD5).toString('hex') : undefined })) ?? {},
    common: (pruneEmpty(toJsonObject(common)) ?? {}) as JsonObject,
    tagTypes: Object.keys(metadata.native),
    pictures: (picture ?? []).map((p) => ({
      format: p.format,
      type: p.type ?? null,
      description: p.description ?? null,
      bytes: p.data.length,
    })),
    warnings: metadata.quality.warnings.map((w) => w.message),
  }
}
