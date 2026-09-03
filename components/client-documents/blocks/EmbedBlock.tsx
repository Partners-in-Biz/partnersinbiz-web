import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'
import { isAllowedEmbed } from '@/lib/client-documents/embedHosts'

type Content = { url: string; height?: number; caption?: string }

export function EmbedBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = (block.content as Content) ?? { url: '' }
  const allowed = isAllowedEmbed(content.url)
  const height = content.height ?? 500
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      {allowed ? (
        <div style={{ height }} className="overflow-hidden rounded-lg">
          <iframe
            src={content.url}
            title={content.caption ?? 'Embedded content'}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="h-full w-full"
            style={{ border: '1px solid var(--doc-border)' }}
          />
        </div>
      ) : (
        <a
          href={content.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border p-6 text-sm text-[var(--doc-accent)] hover:underline"
          style={{ borderColor: 'var(--doc-border)' }}
        >
          <span className="block text-xs uppercase tracking-wider text-[var(--doc-muted)]">
            External link
          </span>
          <span className="mt-1 block break-all">{content.url}</span>
        </a>
      )}
      {content.caption && (
        <p className="mt-2 text-center text-xs text-[var(--doc-muted)]">{content.caption}</p>
      )}
    </BlockFrame>
  )
}
