import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

export function ApprovalBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const body = typeof block.content === 'string' ? block.content : ''
  return (
    <BlockFrame block={block} index={index} noBorder>
      <div
        className="rounded-md border-2 p-8 text-center md:p-12"
        style={{ borderColor: 'var(--doc-accent)', background: 'var(--doc-accent-soft)' }}
      >
        {block.title && (
          <h2 className="text-2xl font-medium text-[var(--doc-text)] md:text-3xl">
            {block.title}
          </h2>
        )}
        <p className="mx-auto mt-4 max-w-prose text-sm leading-6 text-[var(--doc-text)] md:text-base">
          {body}
        </p>
        <p className="mt-6 text-xs uppercase tracking-[0.2em] text-[var(--doc-muted)]">
          Use the Approve button in the portal to sign off.
        </p>
      </div>
    </BlockFrame>
  )
}
