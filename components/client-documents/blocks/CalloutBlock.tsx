import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

const VARIANT_COLORS = {
  info: '#3b82f6',
  warning: '#f59e0b',
  success: '#10b981',
} as const

type CalloutVariant = keyof typeof VARIANT_COLORS

type Content = { title?: string; body?: string; variant?: CalloutVariant }

export function CalloutBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = (block.content as Content) ?? {}
  const variant: CalloutVariant =
    content.variant && content.variant in VARIANT_COLORS ? content.variant : 'info'
  const color = VARIANT_COLORS[variant]
  return (
    <BlockFrame block={block} index={index}>
      <div
        className="rounded-lg border-l-4 p-5"
        style={{ borderColor: color, background: `${color}14` }}
      >
        {content.title && (
          <p
            className="text-sm font-medium uppercase tracking-wide"
            style={{ color }}
          >
            {content.title}
          </p>
        )}
        {content.body && (
          <p className="mt-2 text-sm leading-6 text-[var(--doc-text)]">{content.body}</p>
        )}
      </div>
    </BlockFrame>
  )
}
