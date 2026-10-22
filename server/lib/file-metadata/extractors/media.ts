import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { JsonObject, MediaInfo } from '../types'
import { errorMessage, parseRational, toJson, toJsonObject } from '../util'

const execFileAsync = promisify(execFile)

// ffprobe prints most numbers as strings ("3.003000"); these are safe to coerce.
const NUMERIC_FIELDS = new Set([
  'start_time', 'end_time', 'duration', 'size', 'bit_rate', 'max_bit_rate', 'nb_frames',
  'nb_read_frames', 'nb_read_packets', 'sample_rate', 'bits_per_raw_sample',
])

type Raw = Record<string, unknown>

function coerce(entry: Raw): JsonObject {
  const out: Raw = {}
  for (const [key, value] of Object.entries(entry)) {
    if (NUMERIC_FIELDS.has(key) && typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) out[key] = Number(value)
    else out[key] = value
  }
  return toJsonObject(out)
}

function shapeStream(stream: Raw): JsonObject {
  const { disposition, side_data_list: sideData, ...rest } = stream
  const out = coerce(rest)
  // { default: 1, dub: 0, attached_pic: 0, … } → ["default"]
  if (disposition && typeof disposition === 'object') {
    out.disposition = Object.entries(disposition).filter(([, on]) => on === 1).map(([flag]) => flag)
  }
  if (Array.isArray(sideData) && sideData.length > 0) out.side_data_list = toJson(sideData) ?? []

  if (stream.codec_type === 'video') {
    const fps = parseRational(stream.avg_frame_rate) ?? parseRational(stream.r_frame_rate)
    if (fps) out.fps = fps
    // Phones store portrait video as landscape + a display-matrix rotation.
    const rotation = (sideData as Raw[] | undefined)?.find((d) => typeof d.rotation === 'number')?.rotation as number | undefined
    if (rotation) out.rotation = rotation
    if (typeof stream.width === 'number' && typeof stream.height === 'number') {
      const quarterTurn = rotation !== undefined && Math.abs(rotation) % 180 === 90
      out.displayWidth = quarterTurn ? stream.height : stream.width
      out.displayHeight = quarterTurn ? stream.width : stream.height
    }
  }
  return out
}

/**
 * Container, streams, chapters and programs from ffprobe — the most complete source for
 * codecs, profiles, pixel formats, HDR/colour info, frame rates, bitrates and languages.
 */
export async function extractMedia(
  path: string,
  options: { ffprobePath: string; deep: boolean; signal: AbortSignal; timeoutMs: number },
): Promise<MediaInfo> {
  const args = [
    '-v', 'error', '-hide_banner',
    '-print_format', 'json=compact=1',
    '-show_format', '-show_streams', '-show_chapters', '-show_programs',
    ...(options.deep ? ['-count_packets'] : []), // exact packet counts (reads the whole file)
    // Local files only: playlists/concat files can't make ffprobe open network URLs.
    '-protocol_whitelist', 'file',
    '-i', `file:${path}`,
  ]
  let stdout: string
  try {
    // execFile = no shell, so file names can't inject commands.
    ;({ stdout } = await execFileAsync(options.ffprobePath, args, {
      signal: options.signal,
      timeout: options.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`ffprobe not found ("${options.ffprobePath}"): install FFmpeg or set configureFileMetadata({ ffprobePath })`)
    }
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim()
    throw new Error(stderr ? `ffprobe: ${stderr.split('\n').at(-1)}` : errorMessage(error))
  }
  const raw = JSON.parse(stdout) as { format?: Raw; streams?: Raw[]; chapters?: Raw[]; programs?: Raw[] }

  const { filename: _serverPath, ...format } = raw.format ?? {} // "filename" would leak the absolute path
  return {
    container: coerce(format),
    streams: (raw.streams ?? []).map(shapeStream),
    chapters: (raw.chapters ?? []).map(coerce),
    programs: (raw.programs ?? []).map((program) => toJsonObject(program)),
  }
}
