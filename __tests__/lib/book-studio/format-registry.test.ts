import {
  getBookFormat,
  listBookFormats,
  type BookFormatId,
} from '@/lib/book-studio/format-registry'
import {
  getTrimSpec,
  resolveTrimSpec,
  marginsFor,
  spineWidthIn,
  pt,
} from '@/lib/book-studio/trim'

const ALL_FORMAT_IDS: BookFormatId[] = [
  'story',
  'nonfiction',
  'kids_picture',
  'colouring',
  'comic',
  'activity_workbook',
  'puzzle_sudoku',
  'puzzle_word_search',
  'puzzle_maze',
  'puzzle_crossword',
  'puzzle_mixed',
]

describe('book format registry', () => {
  it('resolves all 11 formats', () => {
    expect(listBookFormats()).toHaveLength(11)
    for (const id of ALL_FORMAT_IDS) {
      const format = getBookFormat(id)
      expect(format).not.toBeNull()
      expect(format?.id).toBe(id)
    }
  })

  it('returns null for unknown format ids', () => {
    expect(getBookFormat('novella')).toBeNull()
    expect(getBookFormat('')).toBeNull()
  })

  it('keeps layout and contentUnits consistent for every entry', () => {
    for (const format of listBookFormats()) {
      if (format.layout === 'reflowable') {
        expect(format.contentUnits).toBe('chapters')
      } else {
        expect(format.layout).toBe('fixed')
        expect(format.contentUnits).toBe('pages')
      }
    }
  })

  it('has a defaultTrim inside supportedTrims that resolves to a trim spec', () => {
    for (const format of listBookFormats()) {
      expect(format.supportedTrims).toContain(format.defaultTrim)
      const spec = resolveTrimSpec(format.defaultTrim)
      expect(spec).not.toBeNull()
      expect(spec?.id).toBe(format.defaultTrim)
    }
  })

  it('marks all puzzle-ish formats with puzzleKind + hasSolutions', () => {
    expect(getBookFormat('puzzle_sudoku')?.puzzleKind).toBe('sudoku')
    expect(getBookFormat('puzzle_word_search')?.puzzleKind).toBe('word_search')
    expect(getBookFormat('puzzle_maze')?.puzzleKind).toBe('maze')
    expect(getBookFormat('puzzle_crossword')?.puzzleKind).toBe('crossword')
    expect(getBookFormat('puzzle_mixed')?.puzzleKind).toBe('mixed')
    expect(getBookFormat('activity_workbook')?.puzzleKind).toBe('mixed')
    for (const id of [
      'activity_workbook',
      'puzzle_sudoku',
      'puzzle_word_search',
      'puzzle_maze',
      'puzzle_crossword',
      'puzzle_mixed',
    ] as BookFormatId[]) {
      expect(getBookFormat(id)?.hasSolutions).toBe(true)
    }
  })
})

describe('trim geometry', () => {
  it('resolves all trim presets with KDP bleed and dpi', () => {
    for (const id of ['5x8', '6x9', '7x10', '8x10', '8.5x8.5', '8.5x11'] as const) {
      const spec = getTrimSpec(id)
      expect(spec.bleedIn).toBe(0.125)
      expect(spec.dpi).toBe(300)
      expect(spec.widthIn).toBeGreaterThan(0)
      expect(spec.heightIn).toBeGreaterThan(spec.widthIn - 1)
    }
    expect(getTrimSpec('6x9')).toMatchObject({ widthIn: 6, heightIn: 9 })
    expect(getTrimSpec('8.5x11')).toMatchObject({ widthIn: 8.5, heightIn: 11 })
  })

  it('returns null from resolveTrimSpec for unknown ids', () => {
    expect(resolveTrimSpec('4x6')).toBeNull()
    expect(resolveTrimSpec('')).toBeNull()
  })

  it('computes KDP gutter bands by page count', () => {
    expect(marginsFor(150).gutterIn).toBe(0.375)
    expect(marginsFor(151).gutterIn).toBe(0.5)
    expect(marginsFor(300).gutterIn).toBe(0.5)
    expect(marginsFor(301).gutterIn).toBe(0.625)
    expect(marginsFor(500).gutterIn).toBe(0.625)
    expect(marginsFor(501).gutterIn).toBe(0.75)
    expect(marginsFor(700).gutterIn).toBe(0.75)
    expect(marginsFor(701).gutterIn).toBe(0.875)
  })

  it('uses safe 0.5in outer margins', () => {
    const margins = marginsFor(200)
    expect(margins.outsideIn).toBe(0.5)
    expect(margins.topIn).toBe(0.5)
    expect(margins.bottomIn).toBe(0.5)
  })

  it('computes KDP spine width for white and cream paper', () => {
    expect(spineWidthIn(200)).toBeCloseTo(0.4504, 4)
    expect(spineWidthIn(200, 'white')).toBeCloseTo(0.4504, 4)
    expect(spineWidthIn(200, 'cream')).toBeCloseTo(0.5, 4)
  })

  it('converts inches to points', () => {
    expect(pt(8.5)).toBe(612)
    expect(pt(11)).toBe(792)
  })
})
