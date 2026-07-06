// Full-wrap cover PDF assembly engine for Book Studio (pdf-lib based).
//
// Builds a single-page KDP-style full-wrap cover: back panel (left), spine
// (center, only for wide-enough / long-enough books), and front panel
// (right) carrying the cover art (or a text fallback when no art exists).

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import sharp from 'sharp'
import { pt, spineWidthIn, type TrimSpec } from '../trim'

const WHITE = rgb(1, 1, 1)
const LIGHT = rgb(0.92, 0.92, 0.92)
const DARK_BG = rgb(0.12, 0.12, 0.16)
const SPINE_BG = rgb(0.16, 0.16, 0.2)
const BACK_BG = rgb(0.14, 0.14, 0.18)

// KDP rule: spine text is only printed when the spine is wide enough to hold
// legible type AND the book has enough pages that a spine actually exists in
// print (KDP itself only prints spine text at 79+ pages, in practice; we use
// 80 as the round-number threshold requested).
const MIN_SPINE_TEXT_WIDTH_IN = 0.0625
const MIN_SPINE_TEXT_PAGES = 80

const BLURB_MAX_CHARS = 1200

export interface BuildCoverPdfInput {
  project: {
    title: string
    metadata?: {
      subtitle?: string
      authorName?: string
      imprint?: string
      isbn?: string
      description?: string
      aiDisclosure?: boolean | string
    }
    coverImageUrl?: string
  }
  trim: TrimSpec
  interiorPageCount: number
  paper?: 'white' | 'cream'
  coverImage?: Buffer
  fetchImage?: (url: string) => Promise<Buffer>
}

export interface BuildCoverPdfResult {
  pdfBytes: Uint8Array
  spineWidthIn: number
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

function centeredTextIn(page: PDFPage, text: string, cx: number, y: number, size: number, font: PDFFont, color = WHITE) {
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: cx - w / 2, y, size, font, color })
}

// Draws an image covering the given panel rect (fill + center-crop), by
// oversizing and centering the scaled image over the target rect.
function drawCoverFit(
  page: PDFPage,
  image: Awaited<ReturnType<PDFDocument['embedJpg']>>,
  rect: { x: number; y: number; w: number; h: number }
) {
  const scale = Math.max(rect.w / image.width, rect.h / image.height)
  const w = image.width * scale
  const h = image.height * scale
  page.drawImage(image, {
    x: rect.x + (rect.w - w) / 2,
    y: rect.y + (rect.h - h) / 2,
    width: w,
    height: h,
  })
}

export async function buildCoverPdf(input: BuildCoverPdfInput): Promise<BuildCoverPdfResult> {
  const { project, trim, interiorPageCount, paper = 'white', coverImage, fetchImage } = input
  const metadata = project.metadata ?? {}

  const spineIn = spineWidthIn(interiorPageCount, paper)
  const bleedIn = trim.bleedIn

  const pageWIn = bleedIn + trim.widthIn + spineIn + trim.widthIn + bleedIn
  const pageHIn = bleedIn + trim.heightIn + bleedIn
  const pageW = pt(pageWIn)
  const pageH = pt(pageHIn)
  const bleedPt = pt(bleedIn)
  const spinePt = pt(spineIn)
  const panelWPt = pt(trim.widthIn)

  const doc = await PDFDocument.create()
  // Deterministic output: pin creation/modification dates so identical
  // inputs produce byte-identical PDFs.
  doc.setCreationDate(new Date(0))
  doc.setModificationDate(new Date(0))
  doc.setTitle(`${project.title} — Cover`)

  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const helv = await doc.embedFont(StandardFonts.Helvetica)

  const page = doc.addPage([pageW, pageH])

  // Panel geometry (left-to-right): back panel | spine | front panel, each
  // inset by bleed on the outer edges only. All panel rects span full
  // page height (including bleed) since the panels are solid/full-bleed.
  const backRect = { x: 0, y: 0, w: bleedPt + panelWPt, h: pageH }
  const spineRect = { x: bleedPt + panelWPt, y: 0, w: spinePt, h: pageH }
  const frontRect = { x: bleedPt + panelWPt + spinePt, y: 0, w: panelWPt + bleedPt, h: pageH }

  // Background fills for all three panels first.
  page.drawRectangle({ x: backRect.x, y: backRect.y, width: backRect.w, height: backRect.h, color: BACK_BG })
  page.drawRectangle({ x: spineRect.x, y: spineRect.y, width: spineRect.w, height: spineRect.h, color: SPINE_BG })
  page.drawRectangle({ x: frontRect.x, y: frontRect.y, width: frontRect.w, height: frontRect.h, color: DARK_BG })

  // --- Front panel (cover art or text fallback) ---
  let art: Buffer | undefined = coverImage
  if (!art && fetchImage && project.coverImageUrl) {
    art = await fetchImage(project.coverImageUrl)
  }

  if (art) {
    const jpeg = await sharp(art).jpeg().toBuffer()
    const image = await doc.embedJpg(jpeg)
    drawCoverFit(page, image, frontRect)
  } else {
    const frontCx = frontRect.x + frontRect.w / 2
    let y = pageH * 0.58
    const titleSize = 28
    const titleMaxW = frontRect.w * 0.85
    for (const line of wrapWords(helvBold, project.title, titleSize, titleMaxW)) {
      centeredTextIn(page, line, frontCx, y, titleSize, helvBold)
      y -= titleSize * 1.25
    }
    if (metadata.authorName) {
      y -= 16
      centeredTextIn(page, metadata.authorName, frontCx, y, 14, helv)
    }
  }

  // --- Spine (center) ---
  const spineTextAllowed = spineIn >= MIN_SPINE_TEXT_WIDTH_IN && interiorPageCount >= MIN_SPINE_TEXT_PAGES
  if (spineTextAllowed) {
    // Clamp text size to fit within the printable spine height (rotated
    // text runs bottom-to-top along the spine's vertical axis, so its
    // "width" when rendered is bounded by pageH, and its "thickness" must
    // fit within spinePt).
    const spineCx = spineRect.x + spineRect.w / 2
    const spineCy = pageH / 2
    const maxThickness = Math.max(6, spinePt - pt(0.06)) // small side margin
    let titleSize = Math.min(18, maxThickness * 0.9)
    titleSize = Math.max(6, titleSize)
    let authorSize = Math.max(5, Math.min(11, maxThickness * 0.55))

    const maxRunLength = pageH * 0.72
    // Shrink title further if it doesn't fit the vertical run length.
    while (
      titleSize > 6 &&
      helvBold.widthOfTextAtSize(project.title, titleSize) > maxRunLength
    ) {
      titleSize -= 0.5
    }
    while (
      metadata.authorName &&
      authorSize > 5 &&
      helv.widthOfTextAtSize(metadata.authorName, authorSize) > maxRunLength
    ) {
      authorSize -= 0.5
    }

    const titleW = helvBold.widthOfTextAtSize(project.title, titleSize)
    page.drawText(project.title, {
      x: spineCx + titleSize * 0.35,
      y: spineCy - titleW / 2,
      size: titleSize,
      font: helvBold,
      color: WHITE,
      rotate: degrees(90),
    })

    if (metadata.authorName) {
      const authorW = helv.widthOfTextAtSize(metadata.authorName, authorSize)
      page.drawText(metadata.authorName, {
        x: spineCx - titleSize * 0.9,
        y: spineCy - authorW / 2,
        size: authorSize,
        font: helv,
        color: LIGHT,
        rotate: degrees(90),
      })
    }
  }

  // --- Back panel (blurb + imprint) ---
  const description = metadata.description
  if (description) {
    const truncated =
      description.length > BLURB_MAX_CHARS ? `${description.slice(0, BLURB_MAX_CHARS)}…` : description
    const blurbSize = 11
    const blurbLeading = 15
    const marginIn = 0.5
    const boxX = backRect.x + pt(marginIn)
    const boxW = backRect.w - pt(marginIn) * 2
    const lines = wrapWords(helv, truncated, blurbSize, boxW)
    let y = pageH * 0.72
    for (const line of lines) {
      page.drawText(line, { x: boxX, y, size: blurbSize, font: helv, color: LIGHT })
      y -= blurbLeading
      if (y < pt(0.75)) break
    }
  }

  if (metadata.imprint) {
    const cx = backRect.x + backRect.w / 2
    centeredTextIn(page, metadata.imprint, cx, bleedPt + pt(0.4), 9, helv, LIGHT)
  }

  const pdfBytes = await doc.save({ useObjectStreams: false })
  return { pdfBytes, spineWidthIn: spineIn }
}
