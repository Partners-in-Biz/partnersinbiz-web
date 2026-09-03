import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

export function RiskBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const items = Array.isArray(block.content)
    ? (block.content as string[])
    : typeof block.content === 'string' && block.content.length > 0
      ? [block.content]
      : []
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li
            key={i}
            className="rounded border-l-4 px-4 py-3 text-sm leading-6 text-[var(--doc-text)]"
            style={{ borderColor: '#f59e0b', background: 'rgba(245, 158, 11, 0.08)' }}
          >
            {item}
          </li>
        ))}
      </ul>
    </BlockFrame>
  )
}
