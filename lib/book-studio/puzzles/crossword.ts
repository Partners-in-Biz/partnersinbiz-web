// Deterministic crossword generator: longest word anchored horizontally
// centered, remaining words placed by crossing existing letters under
// standard adjacency rules, via budget-bounded backtracking over word order.

import { createRng, shuffle } from './prng'
import type {
  GeneratedPuzzle,
  PuzzleCell,
  PuzzleDifficulty,
  PuzzleGridLine,
  PuzzleLabel,
  PuzzleLayout,
} from './types'

export interface PlacedEntry {
  word: string
  clue: string
  row: number
  col: number
  across: boolean
  number: number
}

interface Entry {
  word: string
  clue: string
}

interface Candidate {
  row: number
  col: number
  across: boolean
}

const MIN_PLACED: Record<PuzzleDifficulty, number> = {
  easy: 6,
  medium: 8,
  hard: 10,
  expert: 12,
}

const SEARCH_BUDGET = 40000

function sanitizeEntries(entries: Entry[], size: number): Entry[] {
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const e of entries) {
    const word = e.word.toUpperCase().replace(/[^A-Z]/g, '')
    if (word.length < 3 || word.length > size || seen.has(word)) continue
    seen.add(word)
    out.push({ word, clue: e.clue })
  }
  return out
}

type Grid = (string | null)[][]

// Standard crossword placement rules: fit in bounds, empty/boundary before
// start and after end, at least one crossing, filled cells must match, and
// empty cells must have empty perpendicular neighbours (no parallel words
// touching side-by-side).
function canPlace(grid: Grid, size: number, word: string, cand: Candidate): boolean {
  const { row, col, across } = cand
  const len = word.length
  const endRow = across ? row : row + len - 1
  const endCol = across ? col + len - 1 : col
  if (row < 0 || col < 0 || endRow >= size || endCol >= size) return false

  const at = (r: number, c: number): string | null =>
    r < 0 || r >= size || c < 0 || c >= size ? null : grid[r][c]

  // Cell before start and after end must be empty or off-grid.
  if (across) {
    if (at(row, col - 1) !== null || at(row, col + len) !== null) return false
  } else {
    if (at(row - 1, col) !== null || at(row + len, col) !== null) return false
  }

  let crossings = 0
  for (let i = 0; i < len; i++) {
    const r = across ? row : row + i
    const c = across ? col + i : col
    const existing = grid[r][c]
    if (existing !== null) {
      if (existing !== word[i]) return false
      crossings++
    } else {
      // New letter cell: perpendicular neighbours must be empty.
      if (across) {
        if (at(r - 1, c) !== null || at(r + 1, c) !== null) return false
      } else {
        if (at(r, c - 1) !== null || at(r, c + 1) !== null) return false
      }
    }
  }
  return crossings > 0
}

function findCandidates(grid: Grid, size: number, word: string): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (let i = 0; i < word.length; i++) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] !== word[i]) continue
        for (const cand of [
          { row: r, col: c - i, across: true },
          { row: r - i, col: c, across: false },
        ]) {
          const key = `${cand.row},${cand.col},${cand.across}`
          if (seen.has(key)) continue
          seen.add(key)
          if (canPlace(grid, size, word, cand)) out.push(cand)
        }
      }
    }
  }
  return out
}

function apply(grid: Grid, word: string, cand: Candidate): Array<[number, number]> {
  const written: Array<[number, number]> = []
  for (let i = 0; i < word.length; i++) {
    const r = cand.across ? cand.row : cand.row + i
    const c = cand.across ? cand.col + i : cand.col
    if (grid[r][c] === null) {
      grid[r][c] = word[i]
      written.push([r, c])
    }
  }
  return written
}

export function generateCrossword(
  seed: number,
  difficulty: PuzzleDifficulty,
  params: { entries: Entry[] }
): GeneratedPuzzle & { grid: Grid; placedEntries: PlacedEntry[] } {
  const size = difficulty === 'expert' ? 21 : 15
  const rng = createRng(seed)
  const minPlaced = MIN_PLACED[difficulty]

  const entries = sanitizeEntries(params.entries, size)
  if (entries.length === 0) {
    throw new Error(
      'Crossword: no valid entries after sanitisation (need A-Z words of length 3+ that fit the grid)'
    )
  }
  entries.sort((a, b) => b.word.length - a.word.length)

  const grid: Grid = Array.from({ length: size }, () => Array(size).fill(null))

  // Anchor: longest word horizontally centered.
  const first = entries[0]
  const anchor: Candidate = {
    row: Math.floor(size / 2),
    col: Math.floor((size - first.word.length) / 2),
    across: true,
  }
  apply(grid, first.word, anchor)

  type Placement = { entry: Entry; cand: Candidate }
  const placed: Placement[] = [{ entry: first, cand: anchor }]
  let best: Placement[] = placed.map((p) => ({ ...p }))
  let budget = SEARCH_BUDGET

  const dfs = (remaining: Entry[]): void => {
    if (placed.length > best.length) best = placed.map((p) => ({ ...p }))
    if (best.length === entries.length || budget <= 0) return
    for (let i = 0; i < remaining.length; i++) {
      const entry = remaining[i]
      const cands = shuffle(findCandidates(grid, size, entry.word), rng)
      if (cands.length === 0) continue
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1))
      for (const cand of cands) {
        if (--budget <= 0) return
        const written = apply(grid, entry.word, cand)
        placed.push({ entry, cand })
        dfs(rest)
        placed.pop()
        for (const [r, c] of written) grid[r][c] = null
        if (budget <= 0 || best.length === entries.length) return
      }
    }
  }
  dfs(entries.slice(1))

  if (best.length < minPlaced) {
    throw new Error(
      `Crossword: only ${best.length} of ${entries.length} words could be placed; ${difficulty} requires at least ${minPlaced}`
    )
  }

  // Rebuild final grid from the best placement set.
  for (const row of grid) row.fill(null)
  for (const p of best) apply(grid, p.entry.word, p.cand)

  // Standard numbering: starting squares in reading order, shared across/down.
  const startKey = (p: Placement) => `${p.cand.row},${p.cand.col}`
  const startCells = [...new Set(best.map(startKey))]
    .map((k) => k.split(',').map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const numberByCell = new Map<string, number>()
  startCells.forEach(([r, c], i) => numberByCell.set(`${r},${c}`, i + 1))

  const placedEntries: PlacedEntry[] = best.map((p) => ({
    word: p.entry.word,
    clue: p.entry.clue,
    row: p.cand.row,
    col: p.cand.col,
    across: p.cand.across,
    number: numberByCell.get(startKey(p))!,
  }))

  // Grid lines only around used cells (thin), deduped.
  const segKeys = new Set<string>()
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === null) continue
      segKeys.add(`${c},${r},${c + 1},${r}`) // top
      segKeys.add(`${c},${r + 1},${c + 1},${r + 1}`) // bottom
      segKeys.add(`${c},${r},${c},${r + 1}`) // left
      segKeys.add(`${c + 1},${r},${c + 1},${r + 1}`) // right
    }
  }
  const gridLines: PuzzleGridLine[] = [...segKeys].sort().map((k) => {
    const [x1, y1, x2, y2] = k.split(',').map(Number)
    return { x1, y1, x2, y2, weight: 'thin' as const }
  })

  const labels: PuzzleLabel[] = startCells.map(([r, c], i) => ({
    x: c + 0.08,
    y: r + 0.08,
    text: String(i + 1),
    size: 'small',
  }))

  const blankCells: PuzzleCell[] = []
  const letterCells: PuzzleCell[] = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === null) continue
      blankCells.push({ row: r, col: c })
      letterCells.push({ row: r, col: c, text: grid[r][c]! })
    }
  }

  const clueList = (across: boolean) =>
    placedEntries
      .filter((p) => p.across === across)
      .sort((a, b) => a.number - b.number)
      .map((p) => `${p.number}. ${p.clue}`)

  const layout: PuzzleLayout = {
    rows: size,
    cols: size,
    gridLines,
    cells: blankCells,
    labels,
    lists: [
      { heading: 'Across', items: clueList(true) },
      { heading: 'Down', items: clueList(false) },
    ],
  }
  const solutionLayout: PuzzleLayout = {
    rows: size,
    cols: size,
    gridLines: gridLines.map((l) => ({ ...l })),
    cells: letterCells,
    labels: labels.map((l) => ({ ...l })),
  }

  return {
    grid,
    placedEntries,
    layout,
    solutionLayout,
    meta: { placed: placedEntries.length, requested: entries.length },
  }
}
