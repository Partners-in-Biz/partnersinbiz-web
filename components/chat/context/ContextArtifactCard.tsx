'use client'

import { Icon } from '@/components/studio'
import { useState } from 'react'
import type { ChatArtifactSummary, ChatContextAction } from '@/lib/chat-context/types'
import { displayStateStyle, displayStateLabel } from '@/lib/chat-context/displayStateStyles'
import { safePreviewUrl } from '@/lib/chat-context/safeUrl'

function Preview({ artifact }: { artifact: ChatArtifactSummary }) {
  const preview = artifact.preview
  if (artifact.artifactKind === 'canvas' && (!preview || preview.kind === 'none')) return <div aria-label={`Canvas preview for ${artifact.title}`} className="grid aspect-[2/1] place-items-center bg-primary/10"><Icon name="draw" className="text-3xl text-primary" /></div>
  if (!preview || preview.kind === 'none') return null
  const url = safePreviewUrl(preview.url)
  const thumbnail = safePreviewUrl(preview.thumbnailUrl)
  if (preview.kind === 'image' && (thumbnail || url)) return <img src={thumbnail ?? url} alt={`Preview of ${artifact.title}`} className="aspect-video w-full object-cover" />
  if (preview.kind === 'video' && url) return <video aria-label={`Video preview for ${artifact.title}`} src={url} poster={thumbnail} controls preload="metadata" className="aspect-video w-full bg-black object-contain" />
  if (preview.kind === 'audio' && url) return <audio aria-label={`Audio preview for ${artifact.title}`} src={url} controls preload="metadata" className="w-full px-3 py-2" />
  if (preview.kind === 'document' && url) return <a href={url} className="flex min-h-11 items-center px-3 py-2 text-xs text-primary xl:min-h-0">Open document preview</a>
  return preview.text ? <p className="line-clamp-3 px-3 py-2 text-[11px] text-[var(--color-pib-text-muted)]">{preview.text}</p> : null
}

export function ContextArtifactCard({ artifact, selected = false, onActivate, onAction, pendingActionId }: { artifact: ChatArtifactSummary; selected?: boolean; onActivate?: (artifact: ChatArtifactSummary) => void; onAction?: (action: ChatContextAction) => void; pendingActionId?: string }) {
  const [details, setDetails] = useState(false)
  const stateStyle = displayStateStyle(artifact.state)
  return <article data-selected={selected || undefined} data-state={artifact.state} className={`overflow-hidden rounded-lg border transition-colors ${selected ? 'border-primary/55 bg-primary/[0.08] ring-1 ring-primary/20' : stateStyle.cardClassName}`}>
    <div className="flex">
      <span aria-hidden="true" className="w-1 shrink-0 self-stretch" style={{ background: stateStyle.rail }} />
      <div className="min-w-0 flex-1">
    <Preview artifact={artifact} />
    <button type="button" aria-label={`Inspect ${artifact.title}`} aria-current={selected ? 'true' : undefined} onClick={() => onActivate?.(artifact)} className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 xl:min-h-0">
      <Icon name="draft" className="text-[16px]" />
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[var(--color-pib-text)]">{artifact.title}</span><span className={`mt-0.5 inline-flex rounded-[4px] border px-1.5 py-0.5 text-[10px] ${stateStyle.badgeClassName}`}>{artifact.statusLabel || displayStateLabel(artifact.state)}</span></span>
    </button>
    <div className="flex flex-wrap gap-x-2 gap-y-1 border-t border-white/[0.06] px-3 py-2 text-[10px] text-[var(--color-pib-text-muted)]">
      {artifact.version && <span>{artifact.version}</span>}
      {artifact.updatedAt && <time dateTime={artifact.updatedAt}>Updated {new Date(artifact.updatedAt).toLocaleString()}</time>}
      {artifact.review && <span>{artifact.review.status}{artifact.review.reviewer ? ` · Reviewer: ${artifact.review.reviewer}` : ''}</span>}
    </div>
    {artifact.actions.length > 0 && <div className="flex flex-wrap gap-2 border-t border-white/[0.06] px-3 py-2">{artifact.actions.map((action) => action.href && !action.method ? <a key={action.id} href={action.href} className="inline-flex min-h-11 items-center rounded-sm px-2 text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0">{action.label}</a> : <button key={action.id} type="button" disabled={pendingActionId === action.id} onClick={() => onAction?.(action)} className="min-h-11 rounded-md bg-primary px-2.5 py-1 text-xs text-on-primary outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0">{action.label}</button>)}</div>}
    {artifact.provenance && <div className="border-t border-white/[0.06] px-3 py-2">
      <button type="button" aria-expanded={details} aria-label={`${details ? 'Hide' : 'Show'} provenance for ${artifact.title}`} onClick={() => setDetails((value) => !value)} className="min-h-11 rounded-sm px-2 text-[10px] text-[var(--color-pib-text-muted)] outline-none hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0">{details ? 'Hide' : 'Show'} provenance</button>
      {details && <p className="mt-1 text-[10px] text-[var(--color-pib-text-muted)]">{[artifact.provenance.agentId, artifact.provenance.provider, artifact.provenance.model].filter(Boolean).join(' · ')}{artifact.provenance.sourceIds?.length ? ` · Sources: ${artifact.provenance.sourceIds.join(', ')}` : ''}</p>}
    </div>}
      </div>
    </div>
  </article>
}
