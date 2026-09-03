import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCreativeCanvasByShareToken } from '@/lib/creative-canvas/store'
import type { CreativeCanvasNode } from '@/lib/creative-canvas/types'
import '@/components/studio/studio-ui.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

const NODE_TYPE_LABELS: Record<string, string> = {
  source: 'Source',
  brief: 'Brief',
  prompt: 'Note',
  model: 'Generator',
  edit: 'Edit',
  review: 'Review',
  output: 'Output',
}

function presentationLabel(node: CreativeCanvasNode): string {
  const hint = (node.data as Record<string, unknown> | undefined)?.presentationType
  if (typeof hint === 'string' && hint) {
    return hint.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase())
  }
  return NODE_TYPE_LABELS[node.type] ?? node.type
}

function nodeText(node: CreativeCanvasNode): string | undefined {
  const data = (node.data ?? {}) as Record<string, unknown>
  if (typeof data.text === 'string' && data.text.trim()) return data.text.trim()
  if (node.output?.textPreview) return node.output.textPreview
  if (typeof data.prompt === 'string' && data.prompt.trim()) return data.prompt.trim()
  return undefined
}

function nodeImage(node: CreativeCanvasNode): string | undefined {
  const data = (node.data ?? {}) as Record<string, unknown>
  const fromData = typeof data.assetUrl === 'string' && data.assetUrl ? data.assetUrl : undefined
  return node.output?.thumbnailUrl ?? node.output?.url ?? node.source?.thumbnailUrl ?? node.source?.url ?? fromData
}

export default async function PublicCanvasSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()

  const canvas = await getCreativeCanvasByShareToken(token)
  if (!canvas) notFound()

  const nodes = canvas.nodes ?? []
  const nodeTitle = new Map(nodes.map((node) => [node.id, node.title || node.id]))
  const edges = (canvas.edges ?? []).filter((edge) => nodeTitle.has(edge.sourceNodeId) && nodeTitle.has(edge.targetNodeId))

  return (
    <main className="mx-auto max-w-6xl px-8 py-16">
      <header className="pib-page-header">
        <p className="sc-tiny">Creative canvas · shared preview</p>
        <h1 className="sc-article__h2 mt-2">{canvas.title}</h1>
        <p className="sc-body mt-2">
          {canvas.purpose ? canvas.purpose : 'Read-only preview of this canvas.'}
        </p>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.map((node) => {
          const image = nodeImage(node)
          const text = nodeText(node)
          return (
            <article key={node.id} className="st-panel st-panel--flat">
              <p className="sc-tiny">{presentationLabel(node)}</p>
              <h2 className="st-title mt-2">{node.title}</h2>
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt={node.source?.altText ?? node.title}
                  className="mt-4 h-36 w-full object-cover"
                  style={{ borderRadius: 'var(--st-radius)' }}
                />
              ) : null}
              {text ? (
                <p className="sc-body mt-4 line-clamp-6 whitespace-pre-wrap" style={{ fontSize: '0.875rem' }}>
                  {text}
                </p>
              ) : null}
            </article>
          )
        })}
        {!nodes.length ? (
          <p className="sc-body">This canvas has no content yet.</p>
        ) : null}
      </section>

      {edges.length ? (
        <section className="mt-8">
          <h2 className="st-title">Connections</h2>
          <ul className="sc-body mt-4 space-y-1" style={{ fontSize: '0.875rem' }}>
            {edges.map((edge) => (
              <li key={edge.id}>
                {nodeTitle.get(edge.sourceNodeId)} to {nodeTitle.get(edge.targetNodeId)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-10 border-t border-[var(--sc-line)] pt-4">
        <p className="sc-tiny">Read-only preview shared via Partners in Biz.</p>
      </footer>
    </main>
  )
}
