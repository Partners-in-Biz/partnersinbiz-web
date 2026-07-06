import { PDFDocument } from 'pdf-lib'
import {
  AssemblyMissingAssetError,
  buildInteriorPdf,
  type BuildInteriorPdfInput,
  type InteriorPageInput,
} from '@/lib/book-studio/assembly/interior-pdf'
import { getBookFormat, type BookFormat } from '@/lib/book-studio/format-registry'
import { getTrimSpec } from '@/lib/book-studio/trim'

jest.setTimeout(120000)

// Tiny valid 1x1 PNG; sharp normalizes it to JPEG inside the builder.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const stubFetchImage = async (_url: string): Promise<Buffer> => PNG_1X1

function format(id: string): BookFormat {
  const f = getBookFormat(id)
  if (!f) throw new Error(`unknown format ${id}`)
  return f
}

function sudokuInput(): BuildInteriorPdfInput {
  const pages: InteriorPageInput[] = Array.from({ length: 6 }, (_, i) => ({
    order: i + 1,
    kind: 'puzzle',
    puzzle: { kind: 'sudoku', seed: 1000 + i, difficulty: 'easy' },
  }))
  return {
    project: { title: 'Sudoku Sampler', metadata: { authorName: 'Pip Press' } },
    format: format('puzzle_sudoku'),
    trim: getTrimSpec('8.5x11'),
    pages,
    fetchImage: stubFetchImage,
  }
}

const PARAGRAPH =
  'The harbour town woke slowly under a **pewter** sky, gulls wheeling over the ' +
  'breakwater while fishermen coiled rope and traded rumours of the storm. ' +
  'Marta walked the sea wall as she had every morning for eleven years, counting ' +
  'the cracks in the stone and the small stubborn flowers that grew from them, ' +
  'thinking about the letter in her coat pocket and the *impossible* thing it asked of her.'

function chapterBody(paragraphs: number, withSubheading = true): string {
  const parts: string[] = []
  for (let i = 0; i < paragraphs; i++) {
    if (withSubheading && i === Math.floor(paragraphs / 2)) parts.push('## The Turning Tide')
    parts.push(PARAGRAPH)
  }
  return parts.join('\n\n')
}

function storyInput(aiDisclosure?: boolean): BuildInteriorPdfInput {
  return {
    project: {
      title: 'The Salt Ledger',
      metadata: {
        subtitle: 'A Harbour Mystery',
        authorName: 'A. Tester',
        isbn: '978-1-2345-6789-0',
        ...(aiDisclosure ? { aiDisclosure: true } : {}),
      },
    },
    format: format('story'),
    trim: getTrimSpec('6x9'),
    chapters: [
      { order: 1, title: 'The Letter', body: `# The Letter\n\n${chapterBody(12)}` },
      { order: 2, title: 'The Crossing', body: chapterBody(12) },
    ],
    fetchImage: stubFetchImage,
  }
}

describe('buildInteriorPdf', () => {
  it('builds a sudoku book with solutions back-matter', async () => {
    const { pdfBytes, pageCount } = await buildInteriorPdf(sudokuInput())
    // title + copyright + 6 puzzles + ceil(6/4)=2 solution pages
    expect(pageCount).toBe(10)

    const doc = await PDFDocument.load(pdfBytes)
    expect(doc.getPageCount()).toBe(10)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo((8.5 + 0.25) * 72, 3)
    expect(height).toBeCloseTo((11 + 0.25) * 72, 3)
  })

  it('builds a colouring book from image pages', async () => {
    const pages: InteriorPageInput[] = Array.from({ length: 4 }, (_, i) => ({
      order: i + 1,
      kind: 'colouring',
      imageUrl: `https://assets.example.com/page-${i + 1}.png`,
    }))
    const { pdfBytes, pageCount } = await buildInteriorPdf({
      project: { title: 'Ocean Friends Colouring' },
      format: format('colouring'),
      trim: getTrimSpec('8.5x11'),
      pages,
      fetchImage: stubFetchImage,
    })
    // title + copyright + 4 images; no solutions for colouring books
    expect(pageCount).toBe(6)

    const doc = await PDFDocument.load(pdfBytes)
    expect(doc.getPageCount()).toBe(6)
    const { width, height } = doc.getPage(2).getSize()
    expect(width).toBeCloseTo(8.75 * 72, 3)
    expect(height).toBeCloseTo(11.25 * 72, 3)
  })

  it('collects ALL missing image assets and throws once', async () => {
    const pages: InteriorPageInput[] = [
      { order: 1, kind: 'colouring', imageUrl: 'https://assets.example.com/1.png' },
      { order: 2, kind: 'colouring' },
      { order: 3, kind: 'colouring', imageUrl: 'https://assets.example.com/3.png' },
      { order: 4, kind: 'colouring' },
    ]
    expect.assertions(2)
    try {
      await buildInteriorPdf({
        project: { title: 'Broken Book' },
        format: format('colouring'),
        trim: getTrimSpec('8.5x11'),
        pages,
        fetchImage: stubFetchImage,
      })
    } catch (err) {
      expect(err).toBeInstanceOf(AssemblyMissingAssetError)
      expect((err as AssemblyMissingAssetError).orders).toEqual([2, 4])
    }
  })

  it('builds a reflowable story book from chapters', async () => {
    const { pdfBytes, pageCount } = await buildInteriorPdf(storyInput())
    expect(pageCount).toBeGreaterThanOrEqual(5)

    const doc = await PDFDocument.load(pdfBytes)
    expect(doc.getPageCount()).toBe(pageCount)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(6.25 * 72, 3)
    expect(height).toBeCloseTo(9.25 * 72, 3)
  })

  it('handles the AI disclosure flag without changing structure', async () => {
    const base = await buildInteriorPdf(storyInput())
    const disclosed = await buildInteriorPdf(storyInput(true))
    expect(disclosed.pageCount).toBe(base.pageCount)
    await expect(PDFDocument.load(disclosed.pdfBytes)).resolves.toBeDefined()
  })

  it('is deterministic: identical input produces identical bytes', async () => {
    const a = await buildInteriorPdf(sudokuInput())
    const b = await buildInteriorPdf(sudokuInput())
    expect(b.pageCount).toBe(a.pageCount)
    expect(b.pdfBytes.length).toBe(a.pdfBytes.length)
    expect(Buffer.compare(Buffer.from(a.pdfBytes), Buffer.from(b.pdfBytes))).toBe(0)
  })
})
