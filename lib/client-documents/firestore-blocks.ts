import type { DocumentBlock } from './types'

// Firestore forbids nested arrays (array directly inside array). The `table`
// block stores `content.rows` as `string[][]` for renderer/editor ergonomics,
// so we transform it to/from `{ cells: string[] }[]` at the Firestore boundary.

type TableContentInput = { headers?: unknown; rows?: unknown; [key: string]: unknown }
type TableContentStored = { headers?: unknown; rows?: { cells: string[] }[]; [key: string]: unknown }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function withoutUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => withoutUndefinedDeep(item))
      .filter((item) => item !== undefined) as T
  }

  if (!isPlainObject(value)) return value

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, withoutUndefinedDeep(entry)] as const)
      .filter(([, entry]) => entry !== undefined),
  ) as T
}

export function serializeBlocksForFirestore(blocks: DocumentBlock[]): DocumentBlock[] {
  return blocks.map((inputBlock) => {
    const block = withoutUndefinedDeep(inputBlock)
    if (block.type !== 'table' || !isPlainObject(block.content)) return block
    const content = block.content as TableContentInput
    if (!Array.isArray(content.rows)) return block

    const rows = (content.rows as unknown[]).map((row) =>
      Array.isArray(row) ? { cells: row.map((cell) => (cell == null ? '' : String(cell))) } : { cells: [] },
    )

    return { ...block, content: { ...content, rows } as TableContentStored } as DocumentBlock
  })
}

export function deserializeBlocksFromFirestore(blocks: unknown): DocumentBlock[] {
  if (!Array.isArray(blocks)) return []
  return blocks.map((block) => {
    if (!isPlainObject(block) || block.type !== 'table' || !isPlainObject(block.content)) {
      return block as unknown as DocumentBlock
    }
    const content = block.content as TableContentStored
    if (!Array.isArray(content.rows)) return block as unknown as DocumentBlock

    const rows = content.rows.map((row) => {
      if (Array.isArray(row)) return row.map((cell) => (cell == null ? '' : String(cell)))
      if (isPlainObject(row) && Array.isArray((row as { cells?: unknown }).cells)) {
        return ((row as { cells: unknown[] }).cells).map((cell) => (cell == null ? '' : String(cell)))
      }
      return []
    })

    return { ...block, content: { ...content, rows } } as unknown as DocumentBlock
  })
}
