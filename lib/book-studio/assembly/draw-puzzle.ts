// Draws an abstract PuzzleLayout (cell-unit coordinates) onto a pdf-lib page
// inside a given box (PDF points, origin bottom-left).
//
// Coordinate handling: puzzle layouts use a y-axis that grows DOWNWARD
// (row 0 at the top), while PDF pages have their origin at the bottom-left
// with y growing upward. All layout y values are therefore mapped via
// `gridTop - y * scale`.

import { rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { PuzzleLayout } from '../puzzles/types'

export interface DrawBox {
  x: number
  y: number
  w: number
  h: number
}

const BLACK = rgb(0, 0, 0)
const SHADE = rgb(0.82, 0.82, 0.82)

const THIN_PT = 0.75
const THICK_PT = 2

const TITLE_SIZE = 14
const TITLE_GAP = 8
const LIST_SIZE = 9
const LIST_LEADING = 11
const LIST_GAP_ABOVE = 14
const LIST_COL_GAP = 12

const LABEL_SIZES: Record<'small' | 'normal' | 'large', number> = {
  small: 7,
  normal: 10,
  large: 13,
}

function wrapToWidth(font: PDFFont, text: string, size: number, maxW: number): string[] {
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

interface ListLine {
  text: string
  heading: boolean
}

export function drawPuzzleLayout(
  page: PDFPage,
  layout: PuzzleLayout,
  box: DrawBox,
  font: PDFFont
): void {
  const titleH = layout.title ? TITLE_SIZE + TITLE_GAP : 0

  // Pre-flow list content (word lists / clues) so we know how much of the
  // box to reserve below the grid. Lists take at most 40% of box height.
  const hasLists = Boolean(layout.lists && layout.lists.length > 0)
  const listLines: ListLine[] = []
  let numCols = 2
  let listH = 0
  if (hasLists) {
    const totalItems = layout.lists!.reduce((n, l) => n + l.items.length, 0)
    numCols = totalItems > 20 ? 3 : 2
    const colW = (box.w - LIST_COL_GAP * (numCols - 1)) / numCols
    for (const list of layout.lists!) {
      if (list.heading) listLines.push({ text: list.heading, heading: true })
      for (const item of list.items) {
        for (const line of wrapToWidth(font, item, LIST_SIZE, colW)) {
          listLines.push({ text: line, heading: false })
        }
      }
    }
    const linesPerCol = Math.ceil(listLines.length / numCols)
    const needed = linesPerCol * LIST_LEADING + LIST_GAP_ABOVE
    listH = Math.min(box.h * 0.4, needed)
  }

  // Drawable square for the grid: scale cell units -> points uniformly.
  const gridAreaW = box.w
  const gridAreaH = Math.max(box.h - titleH - listH, 1)
  const scale = Math.min(gridAreaW / layout.cols, gridAreaH / layout.rows)
  const gridW = layout.cols * scale
  const gridH = layout.rows * scale
  const gridLeft = box.x + (box.w - gridW) / 2 // centered horizontally
  const gridTop = box.y + box.h - titleH

  const toX = (unitX: number) => gridLeft + unitX * scale
  const toY = (unitY: number) => gridTop - unitY * scale

  // Title above the grid, inside the box.
  if (layout.title) {
    const tw = font.widthOfTextAtSize(layout.title, TITLE_SIZE)
    page.drawText(layout.title, {
      x: box.x + (box.w - tw) / 2,
      y: box.y + box.h - TITLE_SIZE,
      size: TITLE_SIZE,
      font,
      color: BLACK,
    })
  }

  // 1) Shaded cells first, so they sit BEHIND grid lines and text.
  for (const cell of layout.cells) {
    if (!cell.shaded) continue
    page.drawRectangle({
      x: toX(cell.col),
      y: toY(cell.row + 1),
      width: scale,
      height: scale,
      color: SHADE,
    })
  }

  // 2) Grid lines.
  for (const line of layout.gridLines) {
    page.drawLine({
      start: { x: toX(line.x1), y: toY(line.y1) },
      end: { x: toX(line.x2), y: toY(line.y2) },
      thickness: line.weight === 'thick' ? THICK_PT : THIN_PT,
      color: BLACK,
    })
  }

  // 3) Cell text, centered in each cell.
  const cellTextSize = Math.min(18, Math.max(6, scale * 0.55))
  for (const cell of layout.cells) {
    if (!cell.text) continue
    const tw = font.widthOfTextAtSize(cell.text, cellTextSize)
    page.drawText(cell.text, {
      x: toX(cell.col + 0.5) - tw / 2,
      y: toY(cell.row + 0.5) - cellTextSize * 0.35,
      size: cellTextSize,
      font,
      color: BLACK,
    })
  }

  // 4) Labels (e.g. crossword numbers) at scaled coordinates. The label
  // (x, y) is treated as the top-left anchor in cell-unit space.
  for (const label of layout.labels ?? []) {
    const size = LABEL_SIZES[label.size ?? 'normal']
    page.drawText(label.text, {
      x: toX(label.x),
      y: toY(label.y) - size,
      size,
      font,
      color: BLACK,
    })
  }

  // 5) Lists below the grid, flowed into columns. Content that would
  // overflow the box bottom is clipped (stops drawing).
  if (hasLists && listLines.length > 0) {
    const colW = (box.w - LIST_COL_GAP * (numCols - 1)) / numCols
    const listTop = gridTop - gridH - LIST_GAP_ABOVE
    const linesPerCol = Math.max(1, Math.floor((listTop - box.y) / LIST_LEADING) || 1)
    let col = 0
    let rowInCol = 0
    for (const line of listLines) {
      if (rowInCol >= linesPerCol) {
        col += 1
        rowInCol = 0
      }
      if (col >= numCols) break // clip overflow
      const x = box.x + col * (colW + LIST_COL_GAP)
      const y = listTop - rowInCol * LIST_LEADING - LIST_SIZE
      if (y < box.y) {
        col += 1
        rowInCol = 0
        continue
      }
      page.drawText(line.text, { x, y, size: LIST_SIZE, font, color: BLACK })
      rowInCol += 1
    }
  }
}
