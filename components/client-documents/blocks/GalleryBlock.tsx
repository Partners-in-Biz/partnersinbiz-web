import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

export function GalleryBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const urls = Array.isArray(block.content) ? (block.content as string[]) : []
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {urls.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={url}
            alt=""
            loading="lazy"
            className="aspect-[4/3] w-full rounded-lg object-cover"
            style={{ border: '1px solid var(--doc-border)' }}
          />
        ))}
      </div>
    </BlockFrame>
  )
}
