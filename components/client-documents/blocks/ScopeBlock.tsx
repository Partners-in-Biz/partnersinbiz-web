import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'
import { CheckIcon } from './_icons'

function renderableItem(item: unknown) {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return String(item ?? '')
  const record = item as Record<string, unknown>
  return [
    typeof record.title === 'string' ? record.title : '',
    typeof record.body === 'string' ? record.body : '',
  ].filter(Boolean).join('\n') || JSON.stringify(item)
}

export function ScopeBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content
  const isList = Array.isArray(content)
  const items = isList ? content.map(renderableItem) : []
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-semibold text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      {isList ? (
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-3 text-base leading-7 text-[var(--doc-text)]"
            >
              <span
                className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'var(--doc-accent-soft)' }}
              >
                <CheckIcon className="h-3 w-3" style={{ color: 'var(--doc-accent)' }} />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="whitespace-pre-wrap text-base leading-7 text-[var(--doc-text)] md:text-lg">
          {String(block.content ?? '')}
        </p>
      )}
    </BlockFrame>
  )
}
