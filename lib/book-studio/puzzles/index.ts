// Puzzle generator dispatch for Book Studio.

import type { GeneratedPuzzle, PuzzleDifficulty, PuzzleKind } from './types'
import { generateSudoku } from './sudoku'
import { generateWordSearch } from './word-search'
import { generateMaze } from './maze'
import { generateCrossword } from './crossword'

export * from './types'
export { generateSudoku } from './sudoku'
export { generateWordSearch, type WordPlacement } from './word-search'
export { generateMaze } from './maze'
export { generateCrossword, type PlacedEntry } from './crossword'

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')
}

function isEntryArray(value: unknown): value is Array<{ word: string; clue: string }> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as { word?: unknown }).word === 'string' &&
        typeof (v as { clue?: unknown }).clue === 'string'
    )
  )
}

export function generatePuzzle(
  kind: PuzzleKind,
  seed: number,
  difficulty: PuzzleDifficulty,
  params?: Record<string, unknown>
): GeneratedPuzzle {
  switch (kind) {
    case 'sudoku':
      return generateSudoku(seed, difficulty)
    case 'word_search': {
      const words = params?.words
      if (!isStringArray(words)) {
        throw new Error('word_search requires params.words: a non-empty string[]')
      }
      return generateWordSearch(seed, difficulty, { words })
    }
    case 'maze':
      return generateMaze(seed, difficulty)
    case 'crossword': {
      const entries = params?.entries
      if (!isEntryArray(entries)) {
        throw new Error(
          'crossword requires params.entries: a non-empty { word: string; clue: string }[]'
        )
      }
      return generateCrossword(seed, difficulty, { entries })
    }
    default:
      throw new Error(`Unknown puzzle kind: ${String(kind)}`)
  }
}
