import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

type Content = { items: { q: string; a: string }[] }

export function FaqBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const items = ((block.content as Content)?.items) ?? []
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div className="space-y-2">
        {items.map((item, i) => (
          <details
            key={i}
            className="group rounded-lg border px-5 py-3 transition-all open:bg-[var(--doc-surface)]"
            style={{ borderColor: 'var(--doc-border)' }}
          >
            <summary className="flex cursor-pointer items-center justify-between text-sm font-medium text-[var(--doc-text)] [&::-webkit-details-marker]:hidden">
              <span>{item.q}</span>
              <span
                className="text-xl transition-transform group-open:rotate-45"
                style={{ color: 'var(--doc-accent)' }}
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-sm leading-6 text-[var(--doc-text)] opacity-80">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </BlockFrame>
  )
}
