// Deterministic word-search generator: rng-shuffled candidate placements with
// backtracking, overlaps allowed on matching letters, rng fill for empties.

import { createRng, randInt, shuffle, type Rng } from './prng'
import type {
  GeneratedPuzzle,
  PuzzleCell,
  PuzzleDifficulty,
  PuzzleGridLine,
  PuzzleLayout,
} from './types'

export interface WordPlacement {
  word: string
  row: number
  col: number
  dRow: number
  dCol: number
}

type Dir = [number, number]

const RIGHT_DOWN: Dir[] = [
  [0, 1],
  [1, 0],
]
const WITH_DIAGONALS: Dir[] = [...RIGHT_DOWN, [1, 1], [-1, 1]]
const ALL_EIGHT: Dir[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

const CONFIG: Record<PuzzleDifficulty, { size: number; maxWords: number; dirs: Dir[] }> = {
  easy: { size: 10, maxWords: 8, dirs: RIGHT_DOWN },
  medium: { size: 13, maxWords: 12, dirs: WITH_DIAGONALS },
  hard: { size: 15, maxWords: 18, dirs: ALL_EIGHT },
  expert: { size: 18, maxWords: 24, dirs: ALL_EIGHT },
}

function sanitizeWords(words: string[], size: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of words) {
    const w = raw.toUpperCase().replace(/[^A-Z]/g, '')
    if (w.length < 3 || w.length > size || seen.has(w)) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

function allThinGridLines(size: number): PuzzleGridLine[] {
  const lines: PuzzleGridLine[] = []
  for (let i = 0; i <= size; i++) {
    lines.push({ x1: 0, y1: i, x2: size, y2: i, weight: 'thin' })
    lines.push({ x1: i, y1: 0, x2: i, y2: size, weight: 'thin' })
  }
  return lines
}

function placeAll(
  grid: string[][],
  words: string[],
  dirs: Dir[],
  rng: Rng
): WordPlacement[] {
  const size = grid.length
  const placements: WordPlacement[] = []
  let failedWord: string | null = null

  const tryFrom = (idx: number): boolean => {
    if (idx === words.length) return true
    const word = words[idx]
    const candidates: WordPlacement[] = []
    for (const [dRow, dCol] of dirs) {
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const endRow = row + dRow * (word.length - 1)
          const endCol = col + dCol * (word.length - 1)
          if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) continue
          candidates.push({ word, row, col, dRow, dCol })
        }
      }
    }
    for (const cand of shuffle(candidates, rng)) {
      let ok = true
      for (let i = 0; i < word.length; i++) {
        const cell = grid[cand.row + cand.dRow * i][cand.col + cand.dCol * i]
        if (cell !== '' && cell !== word[i]) {
          ok = false
          break
        }
      }
      if (!ok) continue
      const written: Array<[number, number]> = []
      for (let i = 0; i < word.length; i++) {
        const r = cand.row + cand.dRow * i
        const c = cand.col + cand.dCol * i
        if (grid[r][c] === '') {
          grid[r][c] = word[i]
          written.push([r, c])
        }
      }
      placements.push(cand)
      if (tryFrom(idx + 1)) return true
      placements.pop()
      for (const [r, c] of written) grid[r][c] = ''
    }
    if (failedWord === null) failedWord = word // deepest failure on first descent
    return false
  }

  if (!tryFrom(0)) {
    throw new Error(
      `Word search: could not place word "${failedWord}" on a ${size}x${size} grid with the given word set`
    )
  }
  return placements
}

export function generateWordSearch(
  seed: number,
  difficulty: PuzzleDifficulty,
  params: { words: string[] }
): GeneratedPuzzle & { grid: string[][]; placements: WordPlacement[] } {
  const { size, maxWords, dirs } = CONFIG[difficulty]
  const rng = createRng(seed)

  const sanitized = sanitizeWords(params.words, size)
  if (sanitized.length === 0) {
    throw new Error(
      'Word search: no valid words after sanitisation (need A-Z words of length 3+ that fit the grid)'
    )
  }
  const words = sanitized
    .slice()
    .sort((a, b) => b.length - a.length)
    .slice(0, maxWords)

  const grid: string[][] = Array.from({ length: size }, () => Array(size).fill(''))
  const placements = placeAll(grid, words, dirs, rng)

  const solutionCells = new Set<string>()
  for (const p of placements) {
    for (let i = 0; i < p.word.length; i++) {
      solutionCells.add(`${p.row + p.dRow * i},${p.col + p.dCol * i}`)
    }
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === '') grid[r][c] = String.fromCharCode(65 + randInt(rng, 0, 25))
    }
  }

  const cellsFor = (shadeSolution: boolean): PuzzleCell[] => {
    const cells: PuzzleCell[] = []
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell: PuzzleCell = { row: r, col: c, text: grid[r][c] }
        if (shadeSolution && solutionCells.has(`${r},${c}`)) cell.shaded = true
        cells.push(cell)
      }
    }
    return cells
  }

  const layout: PuzzleLayout = {
    rows: size,
    cols: size,
    gridLines: allThinGridLines(size),
    cells: cellsFor(false),
    lists: [{ heading: 'Find these words', items: words }],
  }
  const solutionLayout: PuzzleLayout = {
    rows: size,
    cols: size,
    gridLines: allThinGridLines(size),
    cells: cellsFor(true),
  }

  return { grid, placements, layout, solutionLayout, meta: { words, gridSize: size } }
}
