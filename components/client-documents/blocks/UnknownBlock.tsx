import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

export function UnknownBlock({ block, index }: { block: DocumentBlock; index: number }) {
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-4 text-2xl font-medium text-[var(--doc-accent)]">{block.title}</h2>
      )}
      <pre className="overflow-auto rounded bg-[var(--doc-surface)] p-4 text-xs text-[var(--doc-muted)]">
        {JSON.stringify(block.content, null, 2)}
      </pre>
      <p className="mt-2 text-xs text-[var(--doc-muted)]">
        No renderer registered for block type &quot;{block.type}&quot;.
      </p>
    </BlockFrame>
  )
}
