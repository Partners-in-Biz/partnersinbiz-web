import type { TrimPresetId } from './trim'

export type BookFormatId =
  | 'story'
  | 'nonfiction'
  | 'kids_picture'
  | 'colouring'
  | 'comic'
  | 'activity_workbook'
  | 'puzzle_sudoku'
  | 'puzzle_word_search'
  | 'puzzle_maze'
  | 'puzzle_crossword'
  | 'puzzle_mixed'

export type PuzzleKind = 'sudoku' | 'word_search' | 'maze' | 'crossword' | 'mixed'

export interface BookFormat {
  id: BookFormatId
  label: string
  layout: 'reflowable' | 'fixed'
  contentUnits: 'chapters' | 'pages'
  defaultTrim: TrimPresetId
  supportedTrims: TrimPresetId[]
  assembly: ('pdf_interior' | 'pdf_cover' | 'epub')[]
  canvasRecipe: 'text_book' | 'picture_book' | 'colouring_book' | 'comic_book' | 'none'
  puzzleKind?: PuzzleKind
  hasSolutions?: boolean
}

function puzzleFormat(id: BookFormatId, label: string, puzzleKind: PuzzleKind): BookFormat {
  return {
    id,
    label,
    layout: 'fixed',
    contentUnits: 'pages',
    defaultTrim: '8.5x11',
    supportedTrims: ['8.5x11'],
    assembly: ['pdf_interior', 'pdf_cover'],
    canvasRecipe: 'none',
    puzzleKind,
    hasSolutions: true,
  }
}

const BOOK_FORMATS: Record<BookFormatId, BookFormat> = {
  story: {
    id: 'story',
    label: 'Story / Fiction',
    layout: 'reflowable',
    contentUnits: 'chapters',
    defaultTrim: '6x9',
    supportedTrims: ['5x8', '6x9', '7x10'],
    assembly: ['pdf_interior', 'pdf_cover', 'epub'],
    canvasRecipe: 'text_book',
  },
  nonfiction: {
    id: 'nonfiction',
    label: 'Non-fiction',
    layout: 'reflowable',
    contentUnits: 'chapters',
    defaultTrim: '6x9',
    supportedTrims: ['5x8', '6x9', '7x10'],
    assembly: ['pdf_interior', 'pdf_cover', 'epub'],
    canvasRecipe: 'text_book',
  },
  kids_picture: {
    id: 'kids_picture',
    label: 'Kids Picture Book',
    layout: 'fixed',
    contentUnits: 'pages',
    defaultTrim: '8.5x8.5',
    supportedTrims: ['8.5x8.5', '8x10'],
    assembly: ['pdf_interior', 'pdf_cover'],
    canvasRecipe: 'picture_book',
  },
  colouring: {
    id: 'colouring',
    label: 'Colouring Book',
    layout: 'fixed',
    contentUnits: 'pages',
    defaultTrim: '8.5x11',
    supportedTrims: ['8.5x11', '8x10'],
    assembly: ['pdf_interior', 'pdf_cover'],
    canvasRecipe: 'colouring_book',
  },
  comic: {
    id: 'comic',
    label: 'Comic Book',
    layout: 'fixed',
    contentUnits: 'pages',
    defaultTrim: '6x9',
    supportedTrims: ['6x9', '7x10'],
    assembly: ['pdf_interior', 'pdf_cover'],
    canvasRecipe: 'comic_book',
  },
  activity_workbook: puzzleFormat('activity_workbook', 'Activity Workbook', 'mixed'),
  puzzle_sudoku: puzzleFormat('puzzle_sudoku', 'Sudoku Puzzle Book', 'sudoku'),
  puzzle_word_search: puzzleFormat('puzzle_word_search', 'Word Search Puzzle Book', 'word_search'),
  puzzle_maze: puzzleFormat('puzzle_maze', 'Maze Puzzle Book', 'maze'),
  puzzle_crossword: puzzleFormat('puzzle_crossword', 'Crossword Puzzle Book', 'crossword'),
  puzzle_mixed: puzzleFormat('puzzle_mixed', 'Mixed Puzzle Book', 'mixed'),
}

export function getBookFormat(id: string): BookFormat | null {
  return BOOK_FORMATS[id as BookFormatId] ?? null
}

export function listBookFormats(): BookFormat[] {
  return Object.values(BOOK_FORMATS)
}
