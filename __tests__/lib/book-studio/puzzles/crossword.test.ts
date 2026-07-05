import { generateCrossword } from '@/lib/book-studio/puzzles/crossword'
import { generatePuzzle } from '@/lib/book-studio/puzzles'
import type { PuzzleDifficulty } from '@/lib/book-studio/puzzles/types'

// Words drawn from a small shared alphabet (A,E,N,O,R,S,T) so they interlock.
const ENTRIES = [
  { word: 'RATES', clue: 'Prices per unit' },
  { word: 'TENSE', clue: 'Past, present or future' },
  { word: 'STONE', clue: 'Rock' },
  { word: 'NOTES', clue: 'Musical marks' },
  { word: 'ONSET', clue: 'Beginning' },
  { word: 'ASSET', clue: 'Something of value' },
  { word: 'STERN', clue: 'Back of a boat' },
  { word: 'SENSE', clue: 'One of five' },
  { word: 'TREAT', clue: 'Something special' },
  { word: 'STAR', clue: 'Twinkles at night' },
  { word: 'EAST', clue: 'Where the sun rises' },
  { word: 'SEAT', clue: 'Place to sit' },
  { word: 'TASTE', clue: 'Sampled flavor' },
  { word: 'ANTES', clue: 'Poker stakes' },
]

const MIN_PLACED: Record<PuzzleDifficulty, number> = {
  easy: 6,
  medium: 8,
  hard: 10,
  expert: 12,
}

type Placed = { word: string; row: number; col: number; across: boolean; number: number }

function readWord(grid: (string | null)[][], p: Placed): string {
  let out = ''
  for (let i = 0; i < p.word.length; i++) {
    const cell = p.across ? grid[p.row][p.col + i] : grid[p.row + i][p.col]
    out += cell ?? '?'
  }
  return out
}

// Reconstruct all maximal horizontal + vertical runs of length >= 2.
function maximalRuns(grid: (string | null)[][]): Array<{
  word: string
  row: number
  col: number
  across: boolean
}> {
  const size = grid.length
  const runs: Array<{ word: string; row: number; col: number; across: boolean }> = []
  for (let r = 0; r < size; r++) {
    let c = 0
    while (c < size) {
      if (grid[r][c] === null) {
        c++
        continue
      }
      let end = c
      while (end < size && grid[r][end] !== null) end++
      if (end - c >= 2) {
        runs.push({
          word: grid[r].slice(c, end).join(''),
          row: r,
          col: c,
          across: true,
        })
      }
      c = end
    }
  }
  for (let c = 0; c < size; c++) {
    let r = 0
    while (r < size) {
      if (grid[r][c] === null) {
        r++
        continue
      }
      let end = r
      while (end < size && grid[end][c] !== null) end++
      if (end - r >= 2) {
        let word = ''
        for (let i = r; i < end; i++) word += grid[i][c]
        runs.push({ word, row: r, col: c, across: false })
      }
      r = end
    }
  }
  return runs
}

describe('generateCrossword', () => {
  test('same seed is deterministic across difficulties', () => {
    for (const difficulty of ['easy', 'medium'] as PuzzleDifficulty[]) {
      const a = generateCrossword(42, difficulty, { entries: ENTRIES })
      const b = generateCrossword(42, difficulty, { entries: ENTRIES })
      expect(b).toEqual(a)
    }
  })

  describe.each(['easy', 'medium', 'hard'] as PuzzleDifficulty[])('%s', (difficulty) => {
    const result = generateCrossword(1337, difficulty, { entries: ENTRIES })

    test('places at least the required number of words', () => {
      expect(result.placedEntries.length).toBeGreaterThanOrEqual(MIN_PLACED[difficulty])
      expect(result.meta).toEqual({
        placed: result.placedEntries.length,
        requested: ENTRIES.length,
      })
    })

    test('every placed entry is readable in the grid at its stated position', () => {
      for (const p of result.placedEntries) {
        expect(readWord(result.grid, p)).toBe(p.word)
      }
    })

    test('adjacency rules hold: every maximal run >= 2 is a placed word', () => {
      const runs = maximalRuns(result.grid)
      const placedKeys = new Set(
        result.placedEntries.map((p) => `${p.word}@${p.row},${p.col},${p.across}`)
      )
      // Each run corresponds to exactly one placed entry — no accidental
      // side-by-side parallel words or extended runs.
      expect(runs).toHaveLength(result.placedEntries.length)
      for (const run of runs) {
        expect(placedKeys.has(`${run.word}@${run.row},${run.col},${run.across}`)).toBe(true)
      }
    })

    test('every word after the first crosses at least one other word', () => {
      // Each placed word must share at least one cell with a perpendicular word.
      const cellsOf = (p: Placed) => {
        const cells: string[] = []
        for (let i = 0; i < p.word.length; i++) {
          cells.push(p.across ? `${p.row},${p.col + i}` : `${p.row + i},${p.col}`)
        }
        return cells
      }
      for (const p of result.placedEntries) {
        if (result.placedEntries.length === 1) break
        const mine = new Set(cellsOf(p))
        const crosses = result.placedEntries.some(
          (q) => q !== p && q.across !== p.across && cellsOf(q).some((c) => mine.has(c))
        )
        expect(crosses).toBe(true)
      }
    })

    test('numbering is sequential ascending in reading order', () => {
      const starts = [
        ...new Map(
          result.placedEntries.map((p) => [`${p.row},${p.col}`, p] as const)
        ).values(),
      ].sort((a, b) => a.row - b.row || a.col - b.col)
      starts.forEach((p, i) => expect(p.number).toBe(i + 1))
      // Across and down sharing a start cell share a number.
      for (const p of result.placedEntries) {
        for (const q of result.placedEntries) {
          if (p.row === q.row && p.col === q.col) expect(p.number).toBe(q.number)
        }
      }
    })

    test('layout: blank cells for used squares, number labels, Across/Down lists', () => {
      const usedCells: string[] = []
      result.grid.forEach((row, r) =>
        row.forEach((cell, c) => {
          if (cell !== null) usedCells.push(`${r},${c}`)
        })
      )
      expect(result.layout.cells.map((c) => `${c.row},${c.col}`).sort()).toEqual(
        usedCells.slice().sort()
      )
      expect(result.layout.cells.every((c) => c.text === undefined)).toBe(true)
      expect(result.layout.gridLines.every((l) => l.weight === 'thin')).toBe(true)

      const labels = result.layout.labels ?? []
      const uniqueStarts = new Set(result.placedEntries.map((p) => `${p.row},${p.col}`))
      expect(labels).toHaveLength(uniqueStarts.size)
      for (const label of labels) {
        expect(label.size).toBe('small')
        const p = result.placedEntries.find((e) => String(e.number) === label.text)!
        expect(label.x).toBeCloseTo(p.col + 0.08)
        expect(label.y).toBeCloseTo(p.row + 0.08)
      }

      const lists = result.layout.lists ?? []
      expect(lists.map((l) => l.heading)).toEqual(['Across', 'Down'])
      const clueCount = lists[0].items.length + lists[1].items.length
      expect(clueCount).toBe(result.placedEntries.length)
      for (const item of [...lists[0].items, ...lists[1].items]) {
        expect(item).toMatch(/^\d+\. .+/)
      }
    })

    test('solution layout fills letters in the same cells', () => {
      expect(result.solutionLayout.cells).toHaveLength(result.layout.cells.length)
      for (const cell of result.solutionLayout.cells) {
        expect(cell.text).toBe(result.grid[cell.row][cell.col])
      }
    })
  })

  test('expert uses a 21x21 grid', () => {
    const result = generateCrossword(7, 'expert', { entries: ENTRIES })
    expect(result.layout.rows).toBe(21)
    expect(result.layout.cols).toBe(21)
    expect(result.grid).toHaveLength(21)
    expect(result.placedEntries.length).toBeGreaterThanOrEqual(MIN_PLACED.expert)
  })

  test('too few placeable entries throws a descriptive error', () => {
    expect(() =>
      generateCrossword(1, 'easy', {
        entries: [
          { word: 'CAT', clue: 'Feline' },
          { word: 'DOG', clue: 'Canine' },
          { word: 'BIRD', clue: 'Flies' },
        ],
      })
    ).toThrow(/requires at least 6/)
  })

  test('garbage-only entries throw', () => {
    expect(() =>
      generateCrossword(1, 'easy', { entries: [{ word: '123', clue: 'x' }] })
    ).toThrow(/no valid entries/i)
  })

  describe('generatePuzzle dispatch', () => {
    test('routes crossword with params.entries', () => {
      const direct = generateCrossword(42, 'easy', { entries: ENTRIES })
      const routed = generatePuzzle('crossword', 42, 'easy', { entries: ENTRIES })
      expect(routed).toEqual(direct)
    })

    test('missing or invalid params.entries throws', () => {
      expect(() => generatePuzzle('crossword', 1, 'easy')).toThrow(/params\.entries/)
      expect(() => generatePuzzle('crossword', 1, 'easy', { entries: [] })).toThrow(
        /params\.entries/
      )
      expect(() =>
        generatePuzzle('crossword', 1, 'easy', { entries: [{ word: 'CAT' }] })
      ).toThrow(/params\.entries/)
    })
  })
})
