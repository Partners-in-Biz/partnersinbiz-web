import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

type Content = {
  url: string
  title: string
  description?: string
  image?: string
  favicon?: string
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function LinkCardBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = (block.content as Content) ?? { url: '', title: '' }
  const hostname = hostnameOf(content.url)
  return (
    <BlockFrame block={block} index={index}>
      <a
        href={content.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex gap-5 rounded-md border p-5 transition-all hover:-translate-y-0.5"
        style={{ borderColor: 'var(--doc-border)', background: 'var(--doc-surface)' }}
      >
        {content.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={content.image}
            alt=""
            className="h-24 w-24 rounded-md object-cover"
            loading="lazy"
          />
        )}
        <div className="flex flex-col justify-center">
          <p className="text-base font-medium text-[var(--doc-text)] group-hover:text-[var(--doc-accent)]">
            {content.title}
          </p>
          {content.description && (
            <p className="mt-1 text-sm text-[var(--doc-muted)]">{content.description}</p>
          )}
          <p className="mt-2 text-xs uppercase tracking-wider text-[var(--doc-accent)]">
            {hostname}
          </p>
        </div>
      </a>
    </BlockFrame>
  )
}
