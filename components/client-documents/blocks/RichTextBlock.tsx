import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

export function RichTextBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const body = typeof block.content === 'string' ? block.content : ''
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div className="prose-doc whitespace-pre-wrap text-base leading-7 text-[var(--doc-text)] md:text-lg">
        {body}
      </div>
    </BlockFrame>
  )
}
