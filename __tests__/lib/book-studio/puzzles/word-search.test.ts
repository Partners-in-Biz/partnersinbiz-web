import { generateWordSearch } from '@/lib/book-studio/puzzles/word-search'
import { generatePuzzle } from '@/lib/book-studio/puzzles'
import type { PuzzleDifficulty } from '@/lib/book-studio/puzzles/types'

const DIFFICULTIES: PuzzleDifficulty[] = ['easy', 'medium', 'hard', 'expert']
const WORDS = ['tiger', 'lion', 'zebra', 'panda', 'eagle', 'shark', 'whale', 'otter']
const SIZES: Record<PuzzleDifficulty, number> = { easy: 10, medium: 13, hard: 15, expert: 18 }
const CAPS: Record<PuzzleDifficulty, number> = { easy: 8, medium: 12, hard: 18, expert: 24 }

const ALL_DIRS: Array<[number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

// Independent scan: find a word anywhere in the grid, any of 8 directions.
function findWord(grid: string[][], word: string): boolean {
  const size = grid.length
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      for (const [dr, dc] of ALL_DIRS) {
        let ok = true
        for (let i = 0; i < word.length; i++) {
          const nr = r + dr * i
          const nc = c + dc * i
          if (nr < 0 || nr >= size || nc < 0 || nc >= size || grid[nr][nc] !== word[i]) {
            ok = false
            break
          }
        }
        if (ok) return true
      }
    }
  }
  return false
}

describe('generateWordSearch', () => {
  test('same seed is deterministic across all difficulties', () => {
    for (const difficulty of DIFFICULTIES) {
      const a = generateWordSearch(42, difficulty, { words: WORDS })
      const b = generateWordSearch(42, difficulty, { words: WORDS })
      expect(b).toEqual(a)
    }
  })

  describe.each(DIFFICULTIES)('%s', (difficulty) => {
    const result = generateWordSearch(1337, difficulty, { words: WORDS })
    const size = SIZES[difficulty]

    test('grid has the expected size and only A-Z letters', () => {
      expect(result.grid).toHaveLength(size)
      for (const row of result.grid) {
        expect(row).toHaveLength(size)
        for (const cell of row) expect(cell).toMatch(/^[A-Z]$/)
      }
    })

    test('every placed word is findable by independent 8-direction scan', () => {
      const words = (result.meta as { words: string[] }).words
      expect(words.length).toBe(WORDS.length) // all 8 fit under every cap
      for (const word of words) {
        expect(findWord(result.grid, word)).toBe(true)
      }
    })

    test('placements match grid letters at stated positions', () => {
      for (const p of result.placements) {
        for (let i = 0; i < p.word.length; i++) {
          expect(result.grid[p.row + p.dRow * i][p.col + p.dCol * i]).toBe(p.word[i])
        }
      }
    })

    test('solution layout shades exactly the placed-word cells', () => {
      const expected = new Set<string>()
      for (const p of result.placements) {
        for (let i = 0; i < p.word.length; i++) {
          expected.add(`${p.row + p.dRow * i},${p.col + p.dCol * i}`)
        }
      }
      const shaded = result.solutionLayout.cells.filter((c) => c.shaded)
      expect(new Set(shaded.map((c) => `${c.row},${c.col}`))).toEqual(expected)
      // Every cell is lettered in both layouts.
      expect(result.layout.cells).toHaveLength(size * size)
      expect(result.solutionLayout.cells).toHaveLength(size * size)
      expect(result.layout.cells.some((c) => c.shaded)).toBe(false)
    })

    test('layout has all-thin grid lines and the word list', () => {
      expect(result.layout.gridLines).toHaveLength(2 * (size + 1))
      expect(result.layout.gridLines.every((l) => l.weight === 'thin')).toBe(true)
      const words = (result.meta as { words: string[] }).words
      expect(result.layout.lists).toEqual([{ heading: 'Find these words', items: words }])
      expect(result.meta).toMatchObject({ gridSize: size })
    })
  })

  test('easy only uses right and down directions', () => {
    for (const seed of [1, 42, 1337]) {
      const result = generateWordSearch(seed, 'easy', { words: WORDS })
      for (const p of result.placements) {
        expect([`0,1`, `1,0`]).toContain(`${p.dRow},${p.dCol}`)
      }
    }
  })

  test('overflow words are trimmed to the difficulty cap, longest first', () => {
    const many = [
      'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
      'india', 'juliett', 'kilo', 'lima',
    ]
    const result = generateWordSearch(7, 'easy', { words: many })
    const words = (result.meta as { words: string[] }).words
    expect(words).toHaveLength(CAPS.easy)
    for (let i = 1; i < words.length; i++) {
      expect(words[i - 1].length).toBeGreaterThanOrEqual(words[i].length)
    }
    expect(result.placements).toHaveLength(CAPS.easy)
  })

  test('sanitisation: garbage-only words throw', () => {
    expect(() => generateWordSearch(1, 'easy', { words: ['123', '!!', 'ab'] })).toThrow(
      /no valid words/i
    )
  })

  test('sanitisation: dedupes, uppercases, strips non A-Z', () => {
    const result = generateWordSearch(5, 'easy', { words: ['ti-ger', 'TIGER', 'tiger', 'zebra'] })
    expect((result.meta as { words: string[] }).words).toEqual(['TIGER', 'ZEBRA'])
  })

  describe('generatePuzzle dispatch', () => {
    test('routes word_search with params.words', () => {
      const direct = generateWordSearch(42, 'medium', { words: WORDS })
      const routed = generatePuzzle('word_search', 42, 'medium', { words: WORDS })
      expect(routed).toEqual(direct)
    })

    test('missing or invalid params.words throws', () => {
      expect(() => generatePuzzle('word_search', 1, 'easy')).toThrow(/params\.words/)
      expect(() => generatePuzzle('word_search', 1, 'easy', {})).toThrow(/params\.words/)
      expect(() => generatePuzzle('word_search', 1, 'easy', { words: [1, 2] })).toThrow(
        /params\.words/
      )
      expect(() => generatePuzzle('word_search', 1, 'easy', { words: [] })).toThrow(
        /params\.words/
      )
    })
  })
})
