import { readFile } from 'node:fs/promises'
import sharp, { type FormatEnum } from 'sharp'
import type { ImageInfo } from '../types'
import { SkipExtractor } from '../util'

export interface ImageThumbnail {
  data: Buffer
  width: number
  height: number
}

export interface ImageResult {
  info: ImageInfo
  thumbnail: ImageThumbnail | null
}

// MIME → libvips loader. Support depends on how libvips was built (sharp's prebuilt binaries
// lack JPEG 2000, JPEG XL, camera RAW, PDF…), so availability is checked at runtime.
const LOADERS: Record<string, keyof FormatEnum> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/apng': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
  'image/avif': 'heif',
  'image/jp2': 'jp2',
  'image/jxl': 'jxl',
  'image/x-portable-pixmap': 'ppm',
  'image/vnd.radiance': 'rad',
  'image/fits': 'fits',
  'image/x-adobe-dng': 'dcraw',
  'image/x-canon-cr2': 'dcraw',
  'image/x-canon-cr3': 'dcraw',
  'image/x-nikon-nef': 'dcraw',
  'image/x-sony-arw': 'dcraw',
  'image/x-fujifilm-raf': 'dcraw',
  'image/x-olympus-orf': 'dcraw',
  'image/x-panasonic-rw2': 'dcraw',
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')

/** dHash: 9×8 greyscale thumbnail, one bit per horizontal gradient. Robust to resizing/re-encoding. */
async function differenceHash(input: string | Buffer): Promise<string> {
  const pixels = await sharp(input, { failOn: 'none' })
    .autoOrient()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw({ depth: 'uchar' }) // 1 byte per pixel even for 16-bit sources
    .toBuffer()
  let bits = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += pixels[y * 9 + x]! > pixels[y * 9 + x + 1]! ? '1' : '0'
  }
  return bits.replace(/[01]{4}/g, (nibble) => parseInt(nibble, 2).toString(16))
}

export async function extractImage(path: string, mime: string, deep: boolean, { withThumbnail = false } = {}): Promise<ImageResult> {
  if (mime === 'image/heic' || mime === 'image/heif') {
    throw new SkipExtractor("HEVC-coded HEIF isn't decodable by sharp's prebuilt libvips; ExifTool still reads its metadata")
  }
  const loader = LOADERS[mime]
  if (!loader || !sharp.format[loader]?.input.file) throw new SkipExtractor(`${mime} is not supported by this libvips build`)

  // SVGs are passed as a buffer: without a base path, librsvg can't resolve references to other local files.
  const input = loader === 'svg' ? await readFile(path) : path
  const meta = await sharp(input, { failOn: 'none' }).metadata() // header only, no pixel decoding

  const info: ImageInfo = {
    decoder: meta.format,
    mediaType: meta.mediaType ?? null,
    width: meta.width,
    height: meta.height,
    displayWidth: meta.autoOrient.width,
    displayHeight: meta.autoOrient.height,
    orientation: meta.orientation ?? null,
    colorSpace: meta.space,
    channels: meta.channels,
    bitDepth: meta.depth,
    bitsPerSample: meta.bitsPerSample ?? null,
    hasAlpha: meta.hasAlpha,
    hasIccProfile: meta.hasProfile,
    isProgressive: meta.isProgressive,
    isPalette: meta.isPalette,
    density: meta.density ?? null,
    resolutionUnit: meta.resolutionUnit ?? null,
    chromaSubsampling: meta.chromaSubsampling ?? null,
    compression: meta.compression ?? null,
    pages: meta.pages ?? 1,
    animated: (meta.pages ?? 1) > 1 && (meta.delay?.length ?? 0) > 0,
    loop: meta.loop ?? null,
    frameDelaysMs: meta.delay ?? null,
    comments: meta.comments ?? [],
    embeddedBlocks: {
      exif: meta.exif?.length,
      icc: meta.icc?.length,
      iptc: meta.iptc?.length,
      xmp: meta.xmp?.length,
      photoshop: meta.tifftagPhotoshop?.length,
      gainMap: meta.gainMap?.image.length,
    },
  }

  // Generate thumbnail while the image is still in libvips' working memory (one decode serves both).
  let thumbnail: ImageThumbnail | null = null
  if (withThumbnail) {
    try {
      const result = await sharp(input, { failOn: 'none' })
        .resize({ width: 64, withoutEnlargement: true })
        .webp({ quality: 50 })
        .toBuffer({ resolveWithObject: true })
      thumbnail = { data: result.data, width: result.info.width, height: result.info.height }
    } catch { /* non-fatal — thumbnail is optional */ }
  }

  if (deep) {
    // Decodes every pixel; libvips' default limitInputPixels still guards against decompression bombs.
    const stats = await sharp(input, { failOn: 'none' }).stats()
    const perceptualHash = await differenceHash(input)
    info.stats = {
      isOpaque: stats.isOpaque,
      entropy: Math.round(stats.entropy * 1000) / 1000,
      sharpness: Math.round(stats.sharpness * 1000) / 1000,
      dominantColor: `#${hex(stats.dominant.r)}${hex(stats.dominant.g)}${hex(stats.dominant.b)}`,
      channels: stats.channels.map(({ min, max, mean, stdev }) => ({
        min,
        max,
        mean: Math.round(mean * 100) / 100,
        stdev: Math.round(stdev * 100) / 100,
      })),
    }
    info.perceptualHash = perceptualHash
  }
  return { info, thumbnail }
}
