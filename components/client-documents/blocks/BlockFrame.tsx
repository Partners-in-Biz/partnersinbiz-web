import type { ReactNode } from 'react'
import type { DocumentBlock } from '@/lib/client-documents/types'

export function BlockFrame({
  block,
  index,
  children,
  noBorder,
  noPadding,
}: {
  block: DocumentBlock
  index: number
  children: ReactNode
  noBorder?: boolean
  noPadding?: boolean
}) {
  return (
    <section
      id={`block-${block.id}`}
      data-block-index={index}
      data-motion={block.display.motion ?? 'none'}
      className={[
        'min-w-0 max-w-full scroll-mt-24',
        noBorder ? '' : 'border-b border-[var(--doc-border)]',
        noPadding ? '' : 'py-12 md:py-16',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </section>
  )
}
