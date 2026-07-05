import { generateMaze } from '@/lib/book-studio/puzzles/maze'
import { generatePuzzle, generateSudoku } from '@/lib/book-studio/puzzles'
import type { PuzzleDifficulty } from '@/lib/book-studio/puzzles/types'

const DIFFICULTIES: PuzzleDifficulty[] = ['easy', 'medium', 'hard', 'expert']
const SIZES: Record<PuzzleDifficulty, number> = { easy: 12, medium: 18, hard: 26, expert: 34 }

type Passage = [number, number, number, number]
type MazeMeta = { rows: number; cols: number; pathLength: number; passages: Passage[] }

function adjacency(meta: MazeMeta): Map<string, Array<[number, number]>> {
  const adj = new Map<string, Array<[number, number]>>()
  const add = (a: [number, number], b: [number, number]) => {
    const key = `${a[0]},${a[1]}`
    if (!adj.has(key)) adj.set(key, [])
    adj.get(key)!.push(b)
  }
  for (const [r1, c1, r2, c2] of meta.passages) {
    add([r1, c1], [r2, c2])
    add([r2, c2], [r1, c1])
  }
  return adj
}

// Independent BFS over meta.passages from entry (0,0) to exit (rows-1,cols-1).
function bfs(meta: MazeMeta): { reached: number; distToExit: number } {
  const adj = adjacency(meta)
  const dist = new Map<string, number>([['0,0', 0]])
  const queue: Array<[number, number]> = [[0, 0]]
  let head = 0
  while (head < queue.length) {
    const [r, c] = queue[head++]
    const d = dist.get(`${r},${c}`)!
    for (const [nr, nc] of adj.get(`${r},${c}`) ?? []) {
      if (!dist.has(`${nr},${nc}`)) {
        dist.set(`${nr},${nc}`, d + 1)
        queue.push([nr, nc])
      }
    }
  }
  return {
    reached: dist.size,
    distToExit: dist.get(`${meta.rows - 1},${meta.cols - 1}`) ?? -1,
  }
}

describe('generateMaze', () => {
  test('same seed is deterministic across all difficulties', () => {
    for (const difficulty of DIFFICULTIES) {
      const a = generateMaze(42, difficulty)
      const b = generateMaze(42, difficulty)
      expect(b).toEqual(a)
    }
  })

  test('different seeds produce different mazes', () => {
    const a = generateMaze(1, 'medium')
    const b = generateMaze(2, 'medium')
    expect((b.meta as MazeMeta).passages).not.toEqual((a.meta as MazeMeta).passages)
  })

  describe.each(DIFFICULTIES)('%s', (difficulty) => {
    const result = generateMaze(1337, difficulty)
    const meta = result.meta as MazeMeta
    const size = SIZES[difficulty]

    test('perfect maze: carved passages === cells - 1 and fully connected', () => {
      expect(meta.rows).toBe(size)
      expect(meta.cols).toBe(size)
      expect(meta.passages).toHaveLength(size * size - 1)
      const { reached } = bfs(meta)
      expect(reached).toBe(size * size) // tree + full connectivity = perfect maze
    })

    test('independent BFS reaches the exit from the entry', () => {
      const { distToExit } = bfs(meta)
      expect(distToExit).toBeGreaterThan(0)
      expect(meta.pathLength).toBe(distToExit + 1)
    })

    test('solution path is valid: starts at entry, ends at exit, steps adjacent and connected', () => {
      const path = result.solutionLayout.cells
      expect(path.length).toBe(meta.pathLength)
      expect(path.every((c) => c.shaded)).toBe(true)
      expect([path[0].row, path[0].col]).toEqual([0, 0])
      expect([path[path.length - 1].row, path[path.length - 1].col]).toEqual([
        size - 1,
        size - 1,
      ])
      const passageSet = new Set(meta.passages.map((p) => p.join(',')))
      const connected = (a: { row: number; col: number }, b: { row: number; col: number }) =>
        passageSet.has([a.row, a.col, b.row, b.col].join(',')) ||
        passageSet.has([b.row, b.col, a.row, a.col].join(','))
      for (let i = 1; i < path.length; i++) {
        const stepDist =
          Math.abs(path[i].row - path[i - 1].row) + Math.abs(path[i].col - path[i - 1].col)
        expect(stepDist).toBe(1)
        expect(connected(path[i - 1], path[i])).toBe(true)
      }
    })

    test('walls match passages; outer border thick with entry/exit gaps', () => {
      const lines = result.layout.gridLines
      const thick = lines.filter((l) => l.weight === 'thick')
      expect(thick).toHaveLength(4)
      // Entry gap: top border starts at x=1; exit gap: bottom ends at x=cols-1.
      const top = thick.find((l) => l.y1 === 0 && l.y2 === 0)!
      const bottom = thick.find((l) => l.y1 === size && l.y2 === size)!
      expect(Math.min(top.x1, top.x2)).toBe(1)
      expect(Math.max(bottom.x1, bottom.x2)).toBe(size - 1)
      // Inner wall count: total interior edges minus carved passages.
      const interiorEdges = 2 * size * (size - 1)
      const thin = lines.filter((l) => l.weight === 'thin')
      expect(thin).toHaveLength(interiorEdges - meta.passages.length)
      // No thin wall where a passage was carved.
      const wallKeys = new Set(thin.map((l) => `${l.x1},${l.y1},${l.x2},${l.y2}`))
      for (const [r1, c1, r2, c2] of meta.passages) {
        const key =
          r1 === r2
            ? `${Math.max(c1, c2)},${r1},${Math.max(c1, c2)},${r1 + 1}` // horizontal passage → vertical wall slot
            : `${c1},${Math.max(r1, r2)},${c1 + 1},${Math.max(r1, r2)}`
        expect(wallKeys.has(key)).toBe(false)
      }
    })

    test('Start and End labels present', () => {
      const texts = (result.layout.labels ?? []).map((l) => l.text)
      expect(texts).toEqual(['Start', 'End'])
      expect((result.layout.labels ?? []).every((l) => l.size === 'small')).toBe(true)
    })
  })

  describe('generatePuzzle dispatch', () => {
    test('routes maze (params ignored)', () => {
      expect(generatePuzzle('maze', 42, 'easy')).toEqual(generateMaze(42, 'easy'))
    })

    test('routes sudoku (params ignored)', () => {
      expect(generatePuzzle('sudoku', 42, 'easy')).toEqual(generateSudoku(42, 'easy'))
    })

    test('unknown kind throws', () => {
      expect(() =>
        generatePuzzle('nonogram' as never, 1, 'easy')
      ).toThrow(/unknown puzzle kind/i)
    })
  })
})
