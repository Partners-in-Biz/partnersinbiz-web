import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

export function TermsBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const body = typeof block.content === 'string' ? block.content : ''
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-xl font-medium text-[var(--doc-text)] md:text-2xl">
          {block.title}
        </h2>
      )}
      <div className="max-w-prose whitespace-pre-wrap text-sm leading-6 text-[var(--doc-muted)]">
        {body}
      </div>
    </BlockFrame>
  )
}
