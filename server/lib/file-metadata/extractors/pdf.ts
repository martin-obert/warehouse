import { readFile } from 'node:fs/promises'
import { extractText, getDocumentProxy, getMeta } from 'unpdf'
import type { JsonObject, JsonValue, PdfInfo, PdfPageSize } from '../types'
import { SkipExtractor, pruneEmpty, toJsonObject } from '../util'

// pdf.js PermissionFlag bits (PDF 32000-1, table 22).
const PERMISSIONS: [number, string][] = [
  [0x004, 'print'], [0x008, 'modify'], [0x010, 'copy'], [0x020, 'annotate'],
  [0x100, 'fill-forms'], [0x200, 'copy-for-accessibility'], [0x400, 'assemble'], [0x800, 'print-high-quality'],
]

const PAPER_SIZES: [string, number, number][] = [
  ['A3', 841.89, 1190.55], ['A4', 595.28, 841.89], ['A5', 419.53, 595.28],
  ['Letter', 612, 792], ['Legal', 612, 1008], ['Tabloid', 792, 1224],
]

function pageSize(view: number[]): PdfPageSize {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = view
  const width = Math.abs(x1 - x0)
  const height = Math.abs(y1 - y0)
  const [short, long] = width < height ? [width, height] : [height, width]
  const paper = PAPER_SIZES.find(([, w, h]) => Math.abs(w - short) < 3 && Math.abs(h - long) < 3)?.[0] ?? null
  const mm = (pt: number) => Math.round((pt * 25.4) / 72)
  return {
    widthPt: Math.round(width * 100) / 100,
    heightPt: Math.round(height * 100) / 100,
    widthMm: mm(width),
    heightMm: mm(height),
    paper,
    orientation: width === height ? 'square' : width > height ? 'landscape' : 'portrait',
  }
}

type OutlineNode = { items?: OutlineNode[] }

// pdf.js returns PDF Name objects as { name: "False" }; unwrap them.
const unwrapName = (value: JsonValue): JsonValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.name === 'string'
    ? value.name
    : value

const countOutline = (nodes: OutlineNode[] | null | undefined): number =>
  (nodes ?? []).reduce((sum, node) => sum + 1 + countOutline(node.items), 0)

/** Document structure via pdf.js (through unpdf): pages, security, forms, signatures, attachments, text layer. */
export async function extractPdf(path: string, deep: boolean): Promise<PdfInfo> {
  const data = new Uint8Array(await readFile(path))
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    pdf = await getDocumentProxy(data, { verbosity: 0 })
  } catch (error) {
    if ((error as Error).name === 'PasswordException') throw new SkipExtractor('password-protected PDF (ExifTool still reports its metadata)')
    throw error
  }

  try {
    const [meta, permissions, attachments, outline, fields, javascript, signatures, markInfo, pageLabels, pageLayout, pageMode, firstPage] =
      await Promise.all([
        getMeta(pdf, { parseDates: true }),
        pdf.getPermissions(),
        pdf.getAttachments(),
        pdf.getOutline(),
        pdf.getFieldObjects(),
        pdf.hasJSActions(),
        pdf.getSignatures(),
        pdf.getMarkInfo(),
        pdf.getPageLabels(),
        pdf.getPageLayout(),
        pdf.getPageMode(),
        pdf.getPage(1),
      ])
    const info: JsonObject =
      pruneEmpty(Object.fromEntries(Object.entries(toJsonObject(meta.info)).map(([key, value]) => [key, unwrapName(value)]))) ?? {}
    const xmpEntries = meta.metadata && Symbol.iterator in meta.metadata ? [...(meta.metadata as Iterable<[string, unknown]>)] : []

    const result: PdfInfo = {
      pages: pdf.numPages,
      version: typeof info.PDFFormatVersion === 'string' ? info.PDFFormatVersion : null,
      info,
      xmp: xmpEntries.length > 0 ? toJsonObject(Object.fromEntries(xmpEntries)) : null,
      fingerprints: pdf.fingerprints.filter((id): id is string => typeof id === 'string'),
      firstPage: { ...pageSize(firstPage.view), rotation: firstPage.rotate },
      linearized: info.IsLinearized === true,
      encrypted: typeof info.EncryptFilterName === 'string',
      permissions: permissions ? PERMISSIONS.filter(([bit]) => permissions.has(bit)).map(([, name]) => name) : null,
      tagged: markInfo ? markInfo.Marked : null,
      forms: { acroForm: info.IsAcroFormPresent === true, xfa: info.IsXFAPresent === true, fieldCount: fields ? fields.size : 0 },
      javascript,
      signatures: (signatures ?? []).map((signature) => toJsonObject(signature)),
      // pdf.js 6 loads attachment bodies lazily; sizes cost a decompression, so only in deep mode.
      attachments: await Promise.all(
        [...(attachments?.entries() ?? [])].map(async ([id, file]) => ({
          name: file.filename || 'unnamed',
          bytes: file.content?.length ?? (deep ? ((await pdf.getAttachmentContent(id))?.length ?? null) : null),
          description: file.description || null,
        })),
      ),
      outlineItems: countOutline(outline as OutlineNode[] | null),
      pageLabels: Array.isArray(pageLabels) && pageLabels.length > 0,
      pageLayout: pageLayout || null,
      pageMode: pageMode || null,
    }

    if (deep) {
      const sizes = new Map<string, PdfPageSize & { count: number }>()
      for (let n = 1; n <= pdf.numPages; n++) {
        const size = pageSize((await pdf.getPage(n)).view)
        const key = `${size.widthPt}x${size.heightPt}`
        const entry = sizes.get(key)
        if (entry) entry.count++
        else sizes.set(key, { ...size, count: 1 })
      }
      result.pageSizes = [...sizes.values()]

      const { text } = await extractText(pdf, { mergePages: false })
      const pagesText = text.map((page) => page.replace(/\s+/g, ' ').trim())
      result.text = {
        characters: pagesText.reduce((sum, page) => sum + page.length, 0),
        pagesWithText: pagesText.filter((page) => page.length > 0).length, // 0 → scanned, needs OCR
        excerpt: pagesText.join(' ').slice(0, 500),
      }
    }
    return result
  } finally {
    await pdf.loadingTask.destroy() // frees pdf.js resources (PDFDocumentProxy has no destroy() in pdf.js 6)
  }
}
