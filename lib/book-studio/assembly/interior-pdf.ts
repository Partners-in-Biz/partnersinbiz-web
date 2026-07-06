// Interior PDF assembly engine for Book Studio (pdf-lib based).
//
// Builds a print-ready interior: title page, copyright page, content
// (fixed image/puzzle/text pages or reflowable chapters), and a solutions
// back-matter section for puzzle formats.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import sharp from 'sharp'
import { marginsFor, pt, type TrimSpec } from '../trim'
import type { BookFormat } from '../format-registry'
import { generatePuzzle } from '../puzzles'
import type { GeneratedPuzzle, PuzzleDifficulty, PuzzleKind } from '../puzzles/types'
import type { BookStudioPageKind, BookStudioPagePuzzle } from '../types'
import { drawPuzzleLayout, type DrawBox } from './draw-puzzle'
import { lineHeightFor, paginateBlocks, stripMarkdown, type Line, type TextBlock } from './text-layout'

const BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)

const BODY_SIZE = 11
const BODY_LEADING = 16
const H1_SIZE = 18
const H2_SIZE = 14
const PAGE_NUM_SIZE = 9

const IMAGE_PAGE_KINDS: BookStudioPageKind[] = ['illustration', 'colouring', 'comic', 'activity']

export class AssemblyMissingAssetError extends Error {
  constructor(public readonly orders: number[]) {
    super(`Pages missing image assets (orders): ${orders.join(', ')}`)
    this.name = 'AssemblyMissingAssetError'
  }
}

export interface InteriorChapterInput {
  title: string
  body: string
  order: number
}

export interface InteriorPageInput {
  order: number
  kind: BookStudioPageKind
  imageUrl?: string
  caption?: string
  puzzle?: BookStudioPagePuzzle
}

export interface BuildInteriorPdfInput {
  project: {
    title: string
    metadata?: {
      subtitle?: string
      authorName?: string
      imprint?: string
      isbn?: string
      aiDisclosure?: boolean
    }
  }
  format: BookFormat
  trim: TrimSpec
  chapters?: InteriorChapterInput[]
  pages?: InteriorPageInput[]
  fetchImage: (url: string) => Promise<Buffer>
}

export interface BuildInteriorPdfResult {
  pdfBytes: Uint8Array
  pageCount: number
}

interface Margins {
  outsideIn: number
  topIn: number
  bottomIn: number
  gutterIn: number
}

function centeredText(page: PDFPage, text: string, y: number, size: number, font: PDFFont) {
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: (page.getWidth() - w) / 2, y, size, font, color: BLACK })
}

function wrapWords(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxW || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function puzzleKindLabel(kind: string): string {
  return kind
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function regenerate(puzzle: BookStudioPagePuzzle): GeneratedPuzzle {
  return generatePuzzle(
    puzzle.kind as PuzzleKind,
    puzzle.seed ?? 1,
    (puzzle.difficulty ?? 'medium') as PuzzleDifficulty,
    puzzle.params
  )
}

export async function buildInteriorPdf(input: BuildInteriorPdfInput): Promise<BuildInteriorPdfResult> {
  const { project, format, trim, fetchImage } = input
  const metadata = project.metadata ?? {}

  const bleedPt = pt(trim.bleedIn)
  const pageW = pt(trim.widthIn + 2 * trim.bleedIn)
  const pageH = pt(trim.heightIn + 2 * trim.bleedIn)

  const doc = await PDFDocument.create()
  // Deterministic output: pin creation/modification dates so identical
  // inputs produce byte-identical PDFs.
  doc.setCreationDate(new Date(0))
  doc.setModificationDate(new Date(0))
  doc.setTitle(project.title)

  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const times = await doc.embedFont(StandardFonts.TimesRoman)
  const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold)

  const reflowable = format.layout === 'reflowable'
  const bodyFont = reflowable ? times : helv
  const headingFont = reflowable ? timesBold : helvBold

  // DELIBERATE SIMPLIFICATION: no odd/even margin mirroring. Both side
  // margins use max(gutter, outside), which satisfies KDP minimums on both
  // the bound and outer edge regardless of page parity.
  const contentBoxFor = (margins: Margins): DrawBox => {
    const sideIn = Math.max(margins.gutterIn, margins.outsideIn)
    return {
      x: bleedPt + pt(sideIn),
      y: bleedPt + pt(margins.bottomIn),
      w: pt(trim.widthIn - 2 * sideIn),
      h: pt(trim.heightIn - margins.topIn - margins.bottomIn),
    }
  }

  const addPage = () => doc.addPage([pageW, pageH])

  const drawPageNumber = (page: PDFPage, n: number, margins: Margins) => {
    const text = String(n)
    const w = helv.widthOfTextAtSize(text, PAGE_NUM_SIZE)
    page.drawText(text, {
      x: (pageW - w) / 2,
      y: bleedPt + pt(margins.bottomIn) / 2,
      size: PAGE_NUM_SIZE,
      font: helv,
      color: BLACK,
    })
  }

  const drawTitlePage = () => {
    const page = addPage()
    // Title centered in the upper third.
    let y = pageH * (2 / 3)
    for (const line of wrapWords(headingFont, project.title, 24, pageW * 0.8)) {
      centeredText(page, line, y, 24, headingFont)
      y -= 32
    }
    if (metadata.subtitle) {
      y -= 12
      for (const line of wrapWords(bodyFont, metadata.subtitle, 14, pageW * 0.8)) {
        centeredText(page, line, y, 14, bodyFont)
        y -= 20
      }
    }
    if (metadata.authorName) {
      centeredText(page, metadata.authorName, pageH * 0.25, 12, bodyFont)
    }
  }

  const drawCopyrightPage = (margins: Margins) => {
    const page = addPage()
    const year = new Date().getFullYear()
    const holder = metadata.authorName ?? metadata.imprint ?? project.title
    const lines: string[] = [`© ${year} ${holder}`, 'All rights reserved.']
    if (metadata.isbn) lines.push(`ISBN ${metadata.isbn}`)
    if (metadata.aiDisclosure) {
      lines.push('Portions of this book were created with the assistance of AI.')
    }
    // Small text block anchored at the bottom margin, first line topmost.
    const size = 8
    const leading = 11
    let y = bleedPt + pt(margins.bottomIn) + (lines.length - 1) * leading
    for (const line of lines) {
      centeredText(page, line, y, size, bodyFont)
      y -= leading
    }
  }

  const drawTextLines = (page: PDFPage, lines: Line[], box: DrawBox) => {
    let cursor = box.y + box.h
    for (const line of lines) {
      const lh = lineHeightFor(line.size, BODY_LEADING)
      cursor -= line.gapBefore + lh
      const font = line.size > BODY_SIZE ? headingFont : bodyFont
      page.drawText(line.text, {
        x: box.x,
        y: cursor + (lh - line.size) * 0.3,
        size: line.size,
        font,
        color: BLACK,
      })
    }
  }

  const paginateOpts = (box: DrawBox) => ({
    font: bodyFont,
    size: BODY_SIZE,
    leading: BODY_LEADING,
    h1Size: H1_SIZE,
    h2Size: H2_SIZE,
    box: { w: box.w, h: box.h },
  })

  if (reflowable) {
    const chapters = [...(input.chapters ?? [])].sort((a, b) => a.order - b.order)

    const paginateAll = (box: DrawBox): Line[][][] =>
      chapters.map((chapter) => {
        const blocks: TextBlock[] = [
          { kind: 'h1', text: chapter.title },
          ...stripMarkdown(chapter.body).blocks,
        ]
        const pages = paginateBlocks(blocks, paginateOpts(box))
        return pages.length > 0 ? pages : [[]]
      })

    // First pass with the <=150-page gutter band; repaginate once if the
    // resulting total crosses into a wider-gutter band.
    let margins = marginsFor(100)
    let chapterPages = paginateAll(contentBoxFor(margins))
    const totalOf = (cp: Line[][][]) => 2 + cp.reduce((n, pages) => n + pages.length, 0)
    const finalMargins = marginsFor(totalOf(chapterPages))
    if (finalMargins.gutterIn !== margins.gutterIn) {
      margins = finalMargins
      chapterPages = paginateAll(contentBoxFor(margins))
    }
    const box = contentBoxFor(margins)

    drawTitlePage()
    drawCopyrightPage(margins)

    let pageNum = 0
    for (const pages of chapterPages) {
      for (const lines of pages) {
        const page = addPage()
        drawTextLines(page, lines, box)
        pageNum += 1
        drawPageNumber(page, pageNum, margins)
      }
    }

    const pdfBytes = await doc.save({ useObjectStreams: false })
    return { pdfBytes, pageCount: doc.getPageCount() }
  }

  // Fixed layout: content units are pages.
  const pages = [...(input.pages ?? [])].sort((a, b) => a.order - b.order)

  // Collect ALL missing image assets first, then throw once.
  const missing = pages
    .filter((p) => IMAGE_PAGE_KINDS.includes(p.kind) && !p.imageUrl)
    .map((p) => p.order)
  if (missing.length > 0) throw new AssemblyMissingAssetError(missing)

  const puzzlePages = pages.filter((p) => p.kind === 'puzzle' && p.puzzle)
  const solutionsPageCount =
    format.hasSolutions && puzzlePages.length > 0 ? Math.ceil(puzzlePages.length / 4) : 0

  // Fixed formats have a deterministic page count (text pages that overflow
  // to multiple pages are rare for these formats), so a single estimate is
  // enough to pick the gutter band.
  const margins = marginsFor(2 + pages.length + solutionsPageCount)
  const box = contentBoxFor(margins)

  drawTitlePage()
  drawCopyrightPage(margins)

  let pageNum = 0
  // Book page number for each puzzle, for the solutions captions.
  const puzzleBookPages = new Map<InteriorPageInput, number>()
  let puzzleIndex = 0

  for (const pageInput of pages) {
    if (IMAGE_PAGE_KINDS.includes(pageInput.kind)) {
      const buf = await fetchImage(pageInput.imageUrl as string)
      // Normalize any input format (PNG/WebP/JPEG) to JPEG via sharp so a
      // single embed path handles everything.
      const jpeg = await sharp(buf).jpeg().toBuffer()
      const image = await doc.embedJpg(jpeg)
      const page = addPage()
      // Full-bleed cover-fit: scale to fill the page, cropping overflow.
      const scale = Math.max(pageW / image.width, pageH / image.height)
      const w = image.width * scale
      const h = image.height * scale
      page.drawImage(image, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h })

      if (format.id === 'kids_picture' && pageInput.caption) {
        const stripH = pageH * 0.12
        page.drawRectangle({ x: 0, y: 0, width: pageW, height: stripH, color: WHITE })
        const capSize = 11
        const capLines = wrapWords(helv, pageInput.caption, capSize, pageW * 0.85).slice(0, 2)
        let y = stripH / 2 + (capLines.length - 1) * 7
        for (const line of capLines) {
          centeredText(page, line, y, capSize, helv)
          y -= 14
        }
      }

      pageNum += 1
      drawPageNumber(page, pageNum, margins)
    } else if (pageInput.kind === 'puzzle' && pageInput.puzzle) {
      puzzleIndex += 1
      const generated = regenerate(pageInput.puzzle)
      const layout = {
        ...generated.layout,
        title: generated.layout.title ?? `Puzzle ${puzzleIndex}`,
      }
      const page = addPage()
      drawPuzzleLayout(page, layout, box, helv)
      pageNum += 1
      puzzleBookPages.set(pageInput, pageNum)
      drawPageNumber(page, pageNum, margins)
    } else {
      // text / front_matter / back_matter (and puzzle pages missing specs).
      const blocks = stripMarkdown(pageInput.caption ?? '').blocks
      const linePages = paginateBlocks(blocks, paginateOpts(box))
      const toRender = linePages.length > 0 ? linePages : [[]]
      for (const lines of toRender) {
        const page = addPage()
        drawTextLines(page, lines, box)
        pageNum += 1
        drawPageNumber(page, pageNum, margins)
      }
    }
  }

  // Solutions back-matter: 2x2 grid, 4 solutions per page. The 'Solutions'
  // heading is drawn at the top of the first solutions page.
  if (solutionsPageCount > 0) {
    const gap = 10
    for (let chunkStart = 0; chunkStart < puzzlePages.length; chunkStart += 4) {
      const chunk = puzzlePages.slice(chunkStart, chunkStart + 4)
      const page = addPage()
      let areaTop = box.y + box.h
      if (chunkStart === 0) {
        centeredText(page, 'Solutions', areaTop - H1_SIZE, H1_SIZE, helvBold)
        areaTop -= H1_SIZE + 14
      }
      const areaH = areaTop - box.y
      const quadW = (box.w - gap) / 2
      const quadH = (areaH - gap) / 2
      const captionH = 12

      chunk.forEach((puzzlePage, i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        const qx = box.x + col * (quadW + gap)
        const qyTop = areaTop - row * (quadH + gap)
        const qy = qyTop - quadH

        const generated = regenerate(puzzlePage.puzzle as BookStudioPagePuzzle)
        drawPuzzleLayout(
          page,
          generated.solutionLayout,
          { x: qx, y: qy + captionH, w: quadW, h: quadH - captionH },
          helv
        )
        const bookPage = puzzleBookPages.get(puzzlePage)
        const caption = `Page ${bookPage} — ${puzzleKindLabel((puzzlePage.puzzle as BookStudioPagePuzzle).kind)}`
        const cw = helv.widthOfTextAtSize(caption, 8)
        page.drawText(caption, { x: qx + (quadW - cw) / 2, y: qy, size: 8, font: helv, color: BLACK })
      })

      pageNum += 1
      drawPageNumber(page, pageNum, margins)
    }
  }

  const pdfBytes = await doc.save({ useObjectStreams: false })
  return { pdfBytes, pageCount: doc.getPageCount() }
}
