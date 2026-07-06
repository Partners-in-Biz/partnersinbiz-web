// Abstract puzzle layout types. Coordinates are in CELL units (row/col
// space); the PDF drawing layer scales them to points.

export type PuzzleKind = 'sudoku' | 'word_search' | 'maze' | 'crossword'

export type PuzzleDifficulty = 'easy' | 'medium' | 'hard' | 'expert'

export interface PuzzleGridLine {
  x1: number
  y1: number
  x2: number
  y2: number
  weight: 'thin' | 'thick'
}

export interface PuzzleCell {
  row: number
  col: number
  text?: string
  shaded?: boolean
}

export interface PuzzleLabel {
  x: number
  y: number
  text: string
  size?: 'small' | 'normal' | 'large'
}

export interface PuzzleList {
  heading: string
  items: string[]
}

export interface PuzzleLayout {
  title?: string
  rows: number
  cols: number
  gridLines: PuzzleGridLine[]
  cells: PuzzleCell[]
  labels?: PuzzleLabel[]
  lists?: PuzzleList[]
}

export interface GeneratedPuzzle {
  layout: PuzzleLayout
  solutionLayout: PuzzleLayout
  meta?: Record<string, unknown>
}
