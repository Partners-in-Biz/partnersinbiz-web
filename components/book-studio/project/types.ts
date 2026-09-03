// Shared shapes for the Book Studio admin project workspace. These are
// intentionally loose (mirrors BookStudioRecord in lib/book-studio/types.ts)
// since Firestore records are only sanitized server-side on write.

export type BookProjectMetadata = {
  title?: string
  subtitle?: string
  authorName?: string
  imprint?: string
  isbn?: string
  description?: string
  language?: string
  aiDisclosure?: string
}

export type BookProjectTrim = {
  presetId?: string
}

export type BookProjectManifestFile = {
  role?: string
  label?: string
  href?: string
  checksum?: string
  bytes?: number
  pageCount?: number
}

export type BookProjectManifest = {
  status?: string
  version?: number | string
  qaStatus?: string
  generatedAt?: string
  files?: BookProjectManifestFile[]
}

export type BookProject = {
  id: string
  orgId: string
  title?: string
  status?: string
  stage?: string
  lifecycleState?: string
  format?: string
  trim?: BookProjectTrim
  stylePrompt?: string
  metadata?: BookProjectMetadata
  coverImageUrl?: string
  creativeCanvasId?: string
  seriesId?: string
  seriesVolumeNumber?: number
  packageManifest?: BookProjectManifest
}

export type BookChapter = {
  id: string
  title?: string
  order?: number
  body?: string
  status?: 'draft' | 'generated' | 'edited' | 'approved'
  wordCount?: number
}

export type BookPagePuzzle = {
  kind?: string
  seed?: number
  difficulty?: string
  params?: { words?: string[]; entries?: { word: string; clue: string }[] }
}

export type BookPageKind =
  | 'illustration'
  | 'colouring'
  | 'comic'
  | 'puzzle'
  | 'activity'
  | 'text'
  | 'front_matter'
  | 'back_matter'

export type BookPage = {
  id: string
  kind?: BookPageKind
  order?: number
  title?: string
  imageUrl?: string
  caption?: string
  prompt?: string
  status?: 'draft' | 'generated' | 'edited' | 'approved'
  puzzle?: BookPagePuzzle
}

export function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ' - '
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`
}

export function humanizeToken(value?: string): string {
  if (!value) return ' - '
  return value.replace(/_/g, ' ')
}
