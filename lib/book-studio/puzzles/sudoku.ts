// Deterministic sudoku generator: randomized-backtracking fill, then hole
// punching with a uniqueness check after every removal.

import { createRng, randInt, shuffle, type Rng } from './prng'
import type {
  GeneratedPuzzle,
  PuzzleCell,
  PuzzleDifficulty,
  PuzzleGridLine,
  PuzzleLayout,
} from './types'

const SIZE = 9
const BOX = 3
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

// Given-count bands per difficulty (min is best-effort target; uniqueness wins).
const BANDS: Record<PuzzleDifficulty, { min: number; max: number }> = {
  easy: { min: 36, max: 40 },
  medium: { min: 30, max: 35 },
  hard: { min: 26, max: 29 },
  expert: { min: 22, max: 25 },
}

function canPlace(grid: number[][], row: number, col: number, val: number): boolean {
  for (let i = 0; i < SIZE; i++) {
    if (grid[row][i] === val || grid[i][col] === val) return false
  }
  const br = row - (row % BOX)
  const bc = col - (col % BOX)
  for (let r = br; r < br + BOX; r++) {
    for (let c = bc; c < bc + BOX; c++) {
      if (grid[r][c] === val) return false
    }
  }
  return true
}

function fillGrid(grid: number[][], rng: Rng): boolean {
  for (let idx = 0; idx < SIZE * SIZE; idx++) {
    const row = Math.floor(idx / SIZE)
    const col = idx % SIZE
    if (grid[row][col] !== 0) continue
    for (const val of shuffle(DIGITS, rng)) {
      if (canPlace(grid, row, col, val)) {
        grid[row][col] = val
        if (fillGrid(grid, rng)) return true
        grid[row][col] = 0
      }
    }
    return false
  }
  return true
}

// Counting solver capped at 2: we only need to know "exactly one" vs "more
// than one", so bailing at 2 keeps hole-punching fast.
function countSolutions(grid: number[][], cap = 2): number {
  let count = 0
  const solve = (): boolean => {
    // Find the most-constrained empty cell to prune the search.
    let bestRow = -1
    let bestCol = -1
    let bestOpts: number[] | null = null
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        if (grid[row][col] !== 0) continue
        const opts = DIGITS.filter((v) => canPlace(grid, row, col, v))
        if (opts.length === 0) return false
        if (!bestOpts || opts.length < bestOpts.length) {
          bestRow = row
          bestCol = col
          bestOpts = opts
          if (opts.length === 1) {
            row = SIZE
            break
          }
        }
      }
    }
    if (!bestOpts) {
      count++
      return count >= cap
    }
    for (const val of bestOpts) {
      grid[bestRow][bestCol] = val
      const done = solve()
      grid[bestRow][bestCol] = 0
      if (done) return true
    }
    return false
  }
  solve()
  return count
}

function sudokuGridLines(): PuzzleGridLine[] {
  const lines: PuzzleGridLine[] = []
  for (let i = 0; i <= SIZE; i++) {
    const weight = i % BOX === 0 ? 'thick' : 'thin'
    lines.push({ x1: 0, y1: i, x2: SIZE, y2: i, weight }) // horizontal
  }
  for (let i = 0; i <= SIZE; i++) {
    const weight = i % BOX === 0 ? 'thick' : 'thin'
    lines.push({ x1: i, y1: 0, x2: i, y2: SIZE, weight }) // vertical
  }
  return lines
}

function gridToCells(grid: number[][], includeZeros: boolean): PuzzleCell[] {
  const cells: PuzzleCell[] = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const val = grid[row][col]
      if (val === 0 && !includeZeros) continue
      cells.push({ row, col, text: String(val) })
    }
  }
  return cells
}

// Try to remove one cell, keeping uniqueness. Returns true when removed.
function tryRemove(puzzle: number[][], idx: number): boolean {
  const row = Math.floor(idx / SIZE)
  const col = idx % SIZE
  const saved = puzzle[row][col]
  puzzle[row][col] = 0
  if (countSolutions(puzzle) !== 1) {
    puzzle[row][col] = saved // removal broke uniqueness; restore
    return false
  }
  return true
}

// One full generation attempt from a concrete rng seed: fill a solution grid,
// pick a target within the band, then punch holes in rng-shuffled order,
// keeping only removals that preserve solution uniqueness. Removals that were
// blocked earlier often become safe after other cells are removed, so if the
// first pass finishes above band.max we keep re-sweeping the restored cells
// (rng-shuffled each pass) until we land in band or a full pass stalls.
function attemptSudoku(
  attemptSeed: number,
  band: { min: number; max: number }
): { puzzle: number[][]; solution: number[][]; givens: number } {
  const rng = createRng(attemptSeed)

  const solution: number[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(0))
  fillGrid(solution, rng)

  const target = randInt(rng, band.min, band.max)
  const puzzle = solution.map((r) => r.slice())
  let givens = SIZE * SIZE

  let restored: number[] = []
  const order = shuffle(
    Array.from({ length: SIZE * SIZE }, (_, i) => i),
    rng
  )
  for (const idx of order) {
    if (givens <= target) break
    if (tryRemove(puzzle, idx)) givens--
    else restored.push(idx)
  }

  // Extra passes over previously-restored cells until in band or stalled.
  while (givens > band.max && restored.length > 0) {
    const pass = shuffle(restored, rng)
    const stillRestored: number[] = []
    let progress = false
    for (const idx of pass) {
      if (givens <= band.max) break
      if (tryRemove(puzzle, idx)) {
        givens--
        progress = true
      } else {
        stillRestored.push(idx)
      }
    }
    restored = stillRestored
    if (!progress) break
  }

  return { puzzle, solution, givens }
}

const MAX_ATTEMPTS = 8

export function generateSudoku(
  seed: number,
  difficulty: PuzzleDifficulty
): GeneratedPuzzle & { puzzle: number[][]; solution: number[][] } {
  const band = BANDS[difficulty]

  // If an attempt still exceeds band.max after multi-pass removal, retry the
  // whole generation with a seed derived deterministically from the original
  // seed. The caller-visible identity stays the input seed: same seed always
  // walks the same attempt sequence, so output is fully deterministic.
  let best: { puzzle: number[][]; solution: number[][]; givens: number } | null = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const attemptSeed = attempt === 0 ? seed : (seed + attempt * 0x9e3779b9) | 0
    const result = attemptSudoku(attemptSeed, band)
    if (!best || result.givens < best.givens) best = result
    if (result.givens <= band.max) break
  }
  // best is always set (loop runs at least once). If every attempt exceeded
  // band.max (shouldn't happen in practice), return the fewest-givens attempt
  // and record actual givens in meta.
  const { puzzle, solution, givens } = best!

  const gridLines = sudokuGridLines()
  const layout: PuzzleLayout = {
    rows: SIZE,
    cols: SIZE,
    gridLines,
    cells: gridToCells(puzzle, false),
  }
  const solutionLayout: PuzzleLayout = {
    rows: SIZE,
    cols: SIZE,
    gridLines: sudokuGridLines(),
    cells: gridToCells(solution, true),
  }

  return {
    puzzle,
    solution,
    layout,
    solutionLayout,
    meta: { givens, difficulty },
  }
}
