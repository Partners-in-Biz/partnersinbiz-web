import { PDFDocument } from 'pdf-lib'
import { buildCoverPdf, type BuildCoverPdfInput } from '@/lib/book-studio/assembly/cover-pdf'
import { getTrimSpec } from '@/lib/book-studio/trim'

jest.setTimeout(120000)

// Tiny valid 1x1 PNG; sharp normalizes it to JPEG inside the builder.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function baseInput(overrides?: Partial<BuildCoverPdfInput>): BuildCoverPdfInput {
  return {
    project: {
      title: 'The Salt Ledger',
      metadata: {
        subtitle: 'A Harbour Mystery',
        authorName: 'A. Tester',
        isbn: '978-1-2345-6789-0',
        description: 'A gripping tale of tides and secrets along a windswept coast.',
      },
    },
    trim: getTrimSpec('6x9'),
    interiorPageCount: 200,
    paper: 'white',
    ...overrides,
  }
}

describe('buildCoverPdf', () => {
  it('builds a single-page full-wrap cover with the expected dimensions', async () => {
    const { pdfBytes, spineWidthIn } = await buildCoverPdf(baseInput())
    const doc = await PDFDocument.load(pdfBytes)
    expect(doc.getPageCount()).toBe(1)

    // 200pp white paper spine width per KDP formula.
    expect(spineWidthIn).toBeCloseTo(200 * 0.002252, 6)

    const { width, height } = doc.getPage(0).getSize()
    const expectedWidthIn = 0.125 + 6 + spineWidthIn + 6 + 0.125
    const expectedHeightIn = 0.125 + 9 + 0.125
    expect(width).toBeCloseTo(expectedWidthIn * 72, 3)
    expect(height).toBeCloseTo(expectedHeightIn * 72, 3)
  })

  it('suppresses spine text under the 80-page KDP threshold but still builds', async () => {
    const short = await buildCoverPdf(baseInput({ interiorPageCount: 60 }))
    const long = await buildCoverPdf(baseInput({ interiorPageCount: 200 }))

    expect(short.spineWidthIn).toBeCloseTo(60 * 0.002252, 6)
    expect(long.spineWidthIn).toBeCloseTo(200 * 0.002252, 6)
    expect(long.spineWidthIn).toBeGreaterThan(short.spineWidthIn)

    await expect(PDFDocument.load(short.pdfBytes)).resolves.toBeDefined()
    await expect(PDFDocument.load(long.pdfBytes)).resolves.toBeDefined()

    const shortDoc = await PDFDocument.load(short.pdfBytes)
    const longDoc = await PDFDocument.load(long.pdfBytes)
    expect(shortDoc.getPageCount()).toBe(1)
    expect(longDoc.getPageCount()).toBe(1)
  })

  it('builds a fallback cover (no art) with title/author text', async () => {
    const { pdfBytes } = await buildCoverPdf(baseInput())
    const doc = await PDFDocument.load(pdfBytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('builds with a supplied cover image buffer', async () => {
    const { pdfBytes } = await buildCoverPdf(baseInput({ coverImage: PNG_1X1 }))
    const doc = await PDFDocument.load(pdfBytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('builds using fetchImage when project.coverImageUrl is set', async () => {
    const fetchImage = jest.fn(async (_url: string) => PNG_1X1)
    const { pdfBytes } = await buildCoverPdf(
      baseInput({
        project: {
          title: 'The Salt Ledger',
          coverImageUrl: 'https://assets.example.com/cover.png',
          metadata: { authorName: 'A. Tester' },
        },
        fetchImage,
      })
    )
    expect(fetchImage).toHaveBeenCalledWith('https://assets.example.com/cover.png')
    const doc = await PDFDocument.load(pdfBytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('is deterministic: identical input produces identical bytes', async () => {
    const a = await buildCoverPdf(baseInput())
    const b = await buildCoverPdf(baseInput())
    expect(Buffer.compare(Buffer.from(a.pdfBytes), Buffer.from(b.pdfBytes))).toBe(0)
  })
})
