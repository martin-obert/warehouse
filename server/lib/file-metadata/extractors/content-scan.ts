import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { ContentScanInfo, HashAlgorithm, TextEncoding } from '../types'

const LF = 0x0a
const CR = 0x0d

interface LineState {
  lf: number
  crlf: number
  cr: number
  lines: number
  lineLength: number
  longest: number
  pendingCr: boolean
}

// Hot loops live in small synchronous functions so V8 optimizes them (not inside the async iterator).
// Four interleaved counters break the load→increment→store dependency on repeated bytes (~1.5× faster).
function countBytes(chunk: Uint8Array, counts: Uint32Array): void {
  const n = chunk.length - (chunk.length % 4)
  let i = 0
  for (; i < n; i += 4) {
    counts[chunk[i]!]!++
    counts[256 + chunk[i + 1]!]!++
    counts[512 + chunk[i + 2]!]!++
    counts[768 + chunk[i + 3]!]!++
  }
  for (; i < chunk.length; i++) counts[chunk[i]!]!++
}

function countLines(chunk: Uint8Array, s: LineState): void {
  for (let i = 0; i < chunk.length; i++) {
    const byte = chunk[i]!
    if (s.pendingCr) {
      s.pendingCr = false
      if (byte === LF) {
        s.crlf++
        endLine(s)
        continue
      }
      s.cr++
      endLine(s)
    }
    if (byte === LF) {
      s.lf++
      endLine(s)
    } else if (byte === CR) s.pendingCr = true
    else s.lineLength++
  }
}

function endLine(s: LineState): void {
  s.lines++
  if (s.lineLength > s.longest) s.longest = s.lineLength
  s.lineLength = 0
}

/**
 * One streaming pass over the whole file computing every content-wide statistic at once:
 * hashes, byte entropy and (for 8-bit-compatible text) line statistics. Memory use is
 * constant; the cost is one sequential read (~1–2 s per GiB on a modest CPU).
 */
export async function scanContent(
  path: string,
  options: { algorithms: readonly HashAlgorithm[]; textEncoding: TextEncoding | null; signal: AbortSignal },
): Promise<ContentScanInfo> {
  const hashers = options.algorithms.map((algorithm) => [algorithm, createHash(algorithm)] as const)
  const histogram = new Float64Array(256) // exact up to 2^53 bytes per value
  const scratch = new Uint32Array(1024) // per-chunk counters, folded into `histogram`
  const isText = options.textEncoding === 'ascii' || options.textEncoding === 'utf-8' || options.textEncoding === 'unknown-8bit'
  const lines: LineState = { lf: 0, crlf: 0, cr: 0, lines: 0, lineLength: 0, longest: 0, pendingCr: false }

  let bytesRead = 0
  let lastByte = -1
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024, signal: options.signal })
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    bytesRead += chunk.length
    for (const [, hash] of hashers) hash.update(chunk)
    countBytes(chunk, scratch)
    for (let b = 0; b < 256; b++) histogram[b]! += scratch[b]! + scratch[256 + b]! + scratch[512 + b]! + scratch[768 + b]!
    scratch.fill(0)
    if (isText) countLines(chunk, lines)
    if (chunk.length > 0) lastByte = chunk[chunk.length - 1]!
  }
  if (lines.pendingCr) {
    lines.cr++
    endLine(lines)
  }
  if (lines.lineLength > 0) endLine(lines) // last line without a terminator

  let entropy = 0
  for (const count of histogram) {
    if (count === 0) continue
    const p = count / bytesRead
    entropy -= p * Math.log2(p)
  }

  const kinds = (['lf', 'crlf', 'cr'] as const).filter((kind) => lines[kind] > 0)
  return {
    bytesRead,
    hashes: Object.fromEntries(hashers.map(([algorithm, hash]) => [algorithm, hash.digest('hex')])),
    byteEntropy: Math.round(entropy * 10_000) / 10_000,
    text: isText
      ? {
          lines: lines.lines,
          lineEndings: kinds.length === 0 ? 'none' : kinds.length > 1 ? 'mixed' : kinds[0]!,
          longestLineBytes: lines.longest,
          trailingNewline: lastByte === LF || lastByte === CR,
        }
      : null,
  }
}
