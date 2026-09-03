import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

export function SummaryBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const body = typeof block.content === 'string' ? block.content : ''
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <p className="whitespace-pre-wrap text-base leading-7 text-[var(--doc-text)] first-letter:float-left first-letter:mr-2 first-letter:text-5xl first-letter:font-medium first-letter:leading-none first-letter:text-[var(--doc-accent)] md:text-lg">
        {body}
      </p>
    </BlockFrame>
  )
}
