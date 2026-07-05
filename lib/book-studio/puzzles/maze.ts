// Deterministic perfect-maze generator: iterative recursive backtracker
// (explicit stack — expert is 34x34, recursion depth would be risky), walls
// rendered as grid lines, BFS solution path.

import { createRng, shuffle } from './prng'
import type {
  GeneratedPuzzle,
  PuzzleCell,
  PuzzleDifficulty,
  PuzzleGridLine,
  PuzzleLabel,
  PuzzleLayout,
} from './types'

const SIZES: Record<PuzzleDifficulty, number> = {
  easy: 12,
  medium: 18,
  hard: 26,
  expert: 34,
}

type Passage = [number, number, number, number] // r1, c1, r2, c2 (normalized order)

function passageKey(r1: number, c1: number, r2: number, c2: number): string {
  // Normalize so key is orientation-independent.
  if (r2 < r1 || (r2 === r1 && c2 < c1)) {
    return `${r2},${c2}|${r1},${c1}`
  }
  return `${r1},${c1}|${r2},${c2}`
}

function carveMaze(rows: number, cols: number, seed: number): Set<string> {
  const rng = createRng(seed)
  const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
  const passages = new Set<string>()
  const stack: Array<[number, number]> = [[0, 0]]
  visited[0][0] = true

  while (stack.length > 0) {
    const [r, c] = stack[stack.length - 1]
    const neighbors: Array<[number, number]> = []
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nr = r + dr
      const nc = c + dc
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc]) {
        neighbors.push([nr, nc])
      }
    }
    if (neighbors.length === 0) {
      stack.pop()
      continue
    }
    const [nr, nc] = shuffle(neighbors, rng)[0]
    visited[nr][nc] = true
    passages.add(passageKey(r, c, nr, nc))
    stack.push([nr, nc])
  }
  return passages
}

function solveBfs(rows: number, cols: number, passages: Set<string>): Array<[number, number]> {
  const connected = (r1: number, c1: number, r2: number, c2: number) =>
    passages.has(passageKey(r1, c1, r2, c2))
  const prev = new Map<string, string | null>()
  prev.set('0,0', null)
  const queue: Array<[number, number]> = [[0, 0]]
  let head = 0
  while (head < queue.length) {
    const [r, c] = queue[head++]
    if (r === rows - 1 && c === cols - 1) break
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nr = r + dr
      const nc = c + dc
      const key = `${nr},${nc}`
      if (
        nr >= 0 &&
        nr < rows &&
        nc >= 0 &&
        nc < cols &&
        !prev.has(key) &&
        connected(r, c, nr, nc)
      ) {
        prev.set(key, `${r},${c}`)
        queue.push([nr, nc])
      }
    }
  }
  const path: Array<[number, number]> = []
  let cur: string | null = `${rows - 1},${cols - 1}`
  while (cur !== null) {
    const [r, c] = cur.split(',').map(Number)
    path.push([r, c])
    cur = prev.get(cur) ?? null
  }
  path.reverse()
  return path
}

function wallLines(rows: number, cols: number, passages: Set<string>): PuzzleGridLine[] {
  const lines: PuzzleGridLine[] = []
  // Outer border (thick), with entry gap at top of (0,0) and exit gap at
  // bottom of (rows-1, cols-1).
  lines.push({ x1: 1, y1: 0, x2: cols, y2: 0, weight: 'thick' }) // top, entry open
  lines.push({ x1: 0, y1: rows, x2: cols - 1, y2: rows, weight: 'thick' }) // bottom, exit open
  lines.push({ x1: 0, y1: 0, x2: 0, y2: rows, weight: 'thick' }) // left
  lines.push({ x1: cols, y1: 0, x2: cols, y2: rows, weight: 'thick' }) // right
  // Inner walls where adjacent cells are not connected.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && !passages.has(passageKey(r, c, r, c + 1))) {
        lines.push({ x1: c + 1, y1: r, x2: c + 1, y2: r + 1, weight: 'thin' })
      }
      if (r + 1 < rows && !passages.has(passageKey(r, c, r + 1, c))) {
        lines.push({ x1: c, y1: r + 1, x2: c + 1, y2: r + 1, weight: 'thin' })
      }
    }
  }
  return lines
}

export function generateMaze(seed: number, difficulty: PuzzleDifficulty): GeneratedPuzzle {
  const size = SIZES[difficulty]
  const rows = size
  const cols = size

  const passageSet = carveMaze(rows, cols, seed)
  const path = solveBfs(rows, cols, passageSet)

  const labels: PuzzleLabel[] = [
    { x: 0.5, y: -0.35, text: 'Start', size: 'small' },
    { x: cols - 0.5, y: rows + 0.35, text: 'End', size: 'small' },
  ]

  const gridLines = wallLines(rows, cols, passageSet)
  const layout: PuzzleLayout = {
    rows,
    cols,
    gridLines,
    cells: [],
    labels,
  }
  // Path cells emitted in path order so the solution is reconstructable.
  const solutionCells: PuzzleCell[] = path.map(([row, col]) => ({ row, col, shaded: true }))
  const solutionLayout: PuzzleLayout = {
    rows,
    cols,
    gridLines: wallLines(rows, cols, passageSet),
    cells: solutionCells,
    labels: labels.map((l) => ({ ...l })),
  }

  const passages: Passage[] = [...passageSet]
    .sort()
    .map((key) => key.split(/[,|]/).map(Number) as Passage)

  return {
    layout,
    solutionLayout,
    meta: { rows, cols, pathLength: path.length, passages },
  }
}
