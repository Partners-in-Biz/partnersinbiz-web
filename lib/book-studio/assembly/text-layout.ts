// Minimal markdown -> plain-text block conversion and greedy pagination for
// the interior PDF assembly engine. Intentionally internal: the repo has no
// general-purpose markdown *stripper* (lib/research/markdown.ts is a
// renderer), and we only need headings + paragraphs + inline-mark removal.

import type { PDFFont } from 'pdf-lib'

export interface TextBlock {
  kind: 'h1' | 'h2' | 'p'
  text: string
}

export interface Line {
  text: string
  size: number
  gapBefore: number
}

function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1') // [text](url) -> text
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold**
    .replace(/__([^_]+)__/g, '$1') // __bold__
    .replace(/\*([^*]+)\*/g, '$1') // *italic*
    .replace(/_([^_]+)_/g, '$1') // _italic_
    .replace(/`([^`]+)`/g, '$1') // `code`
    .replace(/\s+/g, ' ')
    .trim()
}

export function stripMarkdown(body: string): { blocks: TextBlock[] } {
  const blocks: TextBlock[] = []
  const chunks = body.split(/\n\s*\n/)
  for (const chunk of chunks) {
    const raw = chunk.trim()
    if (!raw) continue
    if (raw.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: stripInline(raw.slice(3)) })
    } else if (raw.startsWith('# ')) {
      blocks.push({ kind: 'h1', text: stripInline(raw.slice(2)) })
    } else {
      blocks.push({ kind: 'p', text: stripInline(raw) })
    }
  }
  return { blocks }
}

export interface PaginateOptions {
  font: PDFFont
  size?: number
  leading?: number
  h1Size?: number
  h2Size?: number
  box: { w: number; h: number }
}

export function lineHeightFor(size: number, leading: number): number {
  return Math.max(leading, size * 1.35)
}

const H1_GAP = 20
const H2_GAP = 14
const P_GAP = 8

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

// Greedy word-wrap + pagination. Headings get extra gapBefore and are never
// orphaned at the bottom of a page: if fewer than 3 body lines would fit
// after the heading, it is pushed to the next page.
export function paginateBlocks(blocks: TextBlock[], opts: PaginateOptions): Line[][] {
  const size = opts.size ?? 11
  const leading = opts.leading ?? 16
  const h1Size = opts.h1Size ?? 18
  const h2Size = opts.h2Size ?? 14
  const { font, box } = opts

  const pages: Line[][] = []
  let page: Line[] = []
  let used = 0

  const newPage = () => {
    if (page.length > 0) pages.push(page)
    page = []
    used = 0
  }

  for (const block of blocks) {
    const blockSize = block.kind === 'h1' ? h1Size : block.kind === 'h2' ? h2Size : size
    const blockGap = block.kind === 'h1' ? H1_GAP : block.kind === 'h2' ? H2_GAP : P_GAP
    const lh = lineHeightFor(blockSize, leading)
    const wrapped = wrapWords(font, block.text, blockSize, box.w)

    // Heading orphan rule: require room for the heading plus 3 body lines.
    if (block.kind !== 'p' && page.length > 0) {
      const needed = blockGap + lh + 3 * leading
      if (used + needed > box.h) newPage()
    }

    for (let i = 0; i < wrapped.length; i++) {
      const gapBefore = i === 0 && page.length > 0 ? blockGap : 0
      if (used + gapBefore + lh > box.h && page.length > 0) {
        newPage()
        used += lh
        page.push({ text: wrapped[i], size: blockSize, gapBefore: 0 })
      } else {
        used += gapBefore + lh
        page.push({ text: wrapped[i], size: blockSize, gapBefore })
      }
    }
  }
  if (page.length > 0) pages.push(page)
  return pages
}
