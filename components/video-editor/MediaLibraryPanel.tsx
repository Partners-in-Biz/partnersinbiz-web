'use client'

import { scopedApiPath } from '@/lib/portal/scoped-routing'
import type { EditorClip, EditorMediaKind } from '@/lib/video-editor/types'

type SourceItem = {
  id?: string
  name?: string
  title?: string
  url?: string
  sourceUrl?: string
  mimeType?: string
  assetType?: string
}

function inferKind(source: SourceItem): EditorMediaKind {
  const mime = source.mimeType ?? ''
  const url = source.url ?? source.sourceUrl ?? ''
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(url)) return 'audio'
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return 'image'
  return 'video'
}

export function MediaLibraryPanel({
  orgId,
  sources,
  onRefresh,
  onAddClip,
}: {
  orgId?: string
  sources: SourceItem[]
  onRefresh: () => void
  onAddClip: (clip: EditorClip) => void
}) {
  async function upload(file: File) {
    const form = new FormData()
    form.set('file', file)
    form.set('folder', `video-editor/${orgId || 'workspace'}/imports`)
    if (orgId) form.set('orgId', orgId)
    await fetch(scopedApiPath('/api/v1/creative-canvas/sources/upload', { orgId }), { method: 'POST', body: form })
    onRefresh()
  }

  return (
    <section className="pib-card-section space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-headline text-lg font-semibold text-on-surface">Media</h2>
        <button type="button" className="pib-btn-ghost text-sm" onClick={onRefresh}>Refresh</button>
      </div>
      <label className="block rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-sm text-on-surface-variant">
        Upload media
        <input className="mt-2 block w-full text-xs" type="file" accept="video/*,audio/*,image/*" onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }} />
      </label>
      <div className="space-y-2">
        {sources.length === 0 ? <p className="text-sm text-on-surface-variant">No media in the source library yet.</p> : null}
        {sources.slice(0, 20).map((source) => {
          const url = source.url ?? source.sourceUrl ?? ''
          const mediaKind = inferKind(source)
          return (
            <button
              key={source.id ?? url}
              type="button"
              className="w-full rounded-lg border border-[var(--color-pib-line)] p-3 text-left text-sm hover:border-[var(--color-pib-primary)]"
              disabled={!url}
              onClick={() => onAddClip({
                id: `clip-${Date.now().toString(36)}`,
                timelineStart: 0,
                duration: 5,
                media: { type: 'upload', fileId: source.id ?? `source-${Date.now()}`, url, mediaKind },
              })}
            >
              <span className="block truncate font-medium text-on-surface">{source.title ?? source.name ?? 'Source media'}</span>
              <span className="text-xs text-on-surface-variant">{mediaKind}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
