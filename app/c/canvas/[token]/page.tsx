import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCreativeCanvasByShareToken } from '@/lib/creative-canvas/store'
import type { CreativeCanvasNode } from '@/lib/creative-canvas/types'

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
    <div className="min-h-screen bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
            Creative canvas · shared preview
          </p>
          <h1 className="text-3xl font-semibold">{canvas.title}</h1>
          {canvas.purpose ? (
            <p className="text-lg text-[var(--color-pib-text-muted)] max-w-2xl">{canvas.purpose}</p>
          ) : null}
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nodes.map((node) => {
            const image = nodeImage(node)
            const text = nodeText(node)
            return (
              <article
                key={node.id}
                className="rounded-xl border border-[var(--color-pib-border)] bg-[var(--color-pib-surface)] p-4 space-y-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  {presentationLabel(node)}
                </p>
                <h2 className="text-sm font-semibold">{node.title}</h2>
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image}
                    alt={node.source?.altText ?? node.title}
                    className="h-36 w-full rounded-md object-cover"
                  />
                ) : null}
                {text ? (
                  <p className="text-xs text-[var(--color-pib-text-muted)] whitespace-pre-wrap line-clamp-6">{text}</p>
                ) : null}
              </article>
            )
          })}
          {!nodes.length ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">This canvas has no content yet.</p>
          ) : null}
        </section>

        {edges.length ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">Connections</h2>
            <ul className="space-y-1 text-xs text-[var(--color-pib-text-muted)]">
              {edges.map((edge) => (
                <li key={edge.id}>
                  {nodeTitle.get(edge.sourceNodeId)} → {nodeTitle.get(edge.targetNodeId)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="border-t border-[var(--color-pib-border)] pt-4 text-xs text-[var(--color-pib-text-muted)]">
          Read-only preview shared via Partners in Biz.
        </footer>
      </div>
    </div>
  )
}
