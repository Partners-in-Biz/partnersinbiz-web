import { generateSudoku } from '@/lib/book-studio/puzzles/sudoku'
import type { PuzzleDifficulty } from '@/lib/book-studio/puzzles/types'

const SEEDS = [1, 42, 1337]
const DIFFICULTIES: PuzzleDifficulty[] = ['easy', 'medium', 'hard', 'expert']
const BAND_MAX: Record<PuzzleDifficulty, number> = {
  easy: 40,
  medium: 35,
  hard: 29,
  expert: 25,
}

// Independent counting solver (plain backtracking, cap 2) so uniqueness is
// verified by code that shares nothing with the generator's solver.
function countSolutions(input: number[][], cap = 2): number {
  const grid = input.map((r) => r.slice())
  let count = 0
  const ok = (row: number, col: number, val: number): boolean => {
    for (let i = 0; i < 9; i++) {
      if (grid[row][i] === val || grid[i][col] === val) return false
    }
    const br = row - (row % 3)
    const bc = col - (col % 3)
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) {
        if (grid[r][c] === val) return false
      }
    }
    return true
  }
  const solve = (idx: number): boolean => {
    if (idx === 81) {
      count++
      return count >= cap
    }
    const row = Math.floor(idx / 9)
    const col = idx % 9
    if (grid[row][col] !== 0) return solve(idx + 1)
    for (let val = 1; val <= 9; val++) {
      if (ok(row, col, val)) {
        grid[row][col] = val
        const done = solve(idx + 1)
        grid[row][col] = 0
        if (done) return true
      }
    }
    return false
  }
  solve(0)
  return count
}

function isValidSolution(grid: number[][]): boolean {
  const full = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9])
  const eq = (vals: number[]) =>
    vals.length === 9 && new Set(vals).size === 9 && vals.every((v) => full.has(v))
  for (let i = 0; i < 9; i++) {
    if (!eq(grid[i])) return false
    if (!eq(grid.map((r) => r[i]))) return false
  }
  for (let br = 0; br < 9; br += 3) {
    for (let bc = 0; bc < 9; bc += 3) {
      const box: number[] = []
      for (let r = br; r < br + 3; r++) {
        for (let c = bc; c < bc + 3; c++) box.push(grid[r][c])
      }
      if (!eq(box)) return false
    }
  }
  return true
}

describe('generateSudoku', () => {
  test('same seed + difficulty is deterministic', () => {
    for (const difficulty of DIFFICULTIES) {
      const a = generateSudoku(42, difficulty)
      const b = generateSudoku(42, difficulty)
      expect(b).toEqual(a)
    }
  })

  test('different seeds produce different puzzles', () => {
    const a = generateSudoku(1, 'medium')
    const b = generateSudoku(2, 'medium')
    expect(b.solution).not.toEqual(a.solution)
  })

  describe.each(SEEDS)('seed %i', (seed) => {
    describe.each(DIFFICULTIES)('%s', (difficulty) => {
      const result = generateSudoku(seed, difficulty)

      test('solution is a valid completed grid', () => {
        expect(isValidSolution(result.solution)).toBe(true)
      })

      test('puzzle is a subset of the solution and givens match meta', () => {
        let givens = 0
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            const v = result.puzzle[r][c]
            if (v !== 0) {
              expect(v).toBe(result.solution[r][c])
              givens++
            }
          }
        }
        expect(result.meta).toEqual({ givens, difficulty })
      })

      test('puzzle has exactly one solution (independent solver)', () => {
        expect(countSolutions(result.puzzle)).toBe(1)
      })

      test('givens are within band limits', () => {
        const givens = (result.meta as { givens: number }).givens
        expect(givens).toBeLessThanOrEqual(BAND_MAX[difficulty])
        expect(givens).toBeGreaterThanOrEqual(17) // hard theoretical floor
      })

      test('layout structure: 20 grid lines with thick box borders', () => {
        for (const layout of [result.layout, result.solutionLayout]) {
          expect(layout.rows).toBe(9)
          expect(layout.cols).toBe(9)
          expect(layout.gridLines).toHaveLength(20)
          const horizontal = layout.gridLines.filter((l) => l.y1 === l.y2)
          const vertical = layout.gridLines.filter((l) => l.x1 === l.x2)
          expect(horizontal).toHaveLength(10)
          expect(vertical).toHaveLength(10)
          for (const [i, line] of horizontal.entries()) {
            expect(line.weight).toBe(i % 3 === 0 ? 'thick' : 'thin')
            expect(line.x1).toBe(0)
            expect(line.x2).toBe(9)
          }
          for (const [i, line] of vertical.entries()) {
            expect(line.weight).toBe(i % 3 === 0 ? 'thick' : 'thin')
            expect(line.y1).toBe(0)
            expect(line.y2).toBe(9)
          }
        }
      })

      test('layout cells match givens; solution layout has all 81', () => {
        const meta = result.meta as { givens: number }
        expect(result.layout.cells).toHaveLength(meta.givens)
        expect(result.solutionLayout.cells).toHaveLength(81)
        for (const cell of result.layout.cells) {
          expect(cell.text).toBe(String(result.puzzle[cell.row][cell.col]))
        }
      })
    })
  })

  test('easy has more givens than expert', () => {
    for (const seed of SEEDS) {
      const easy = (generateSudoku(seed, 'easy').meta as { givens: number }).givens
      const expert = (generateSudoku(seed, 'expert').meta as { givens: number }).givens
      expect(easy).toBeGreaterThan(expert)
    }
  })
})
