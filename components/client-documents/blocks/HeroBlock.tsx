import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

export function HeroBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const subtitle = typeof block.content === 'string' ? block.content : ''
  return (
    <BlockFrame block={block} index={index} noBorder>
      <div className="relative min-h-[50vh] flex flex-col justify-center py-10">
        {block.title && (
          <p className="text-xs uppercase tracking-[0.25em] text-[var(--doc-accent)]">{block.title}</p>
        )}
        <p className="mt-6 max-w-3xl text-2xl font-medium leading-snug text-[var(--doc-text)] md:text-4xl">
          {subtitle}
        </p>
        <div
          className="mt-12 h-[3px] w-24 rounded-md"
          style={{ background: 'var(--doc-accent)' }}
          data-testid="hero-stripe"
        />
      </div>
    </BlockFrame>
  )
}
