'use client'

import { useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { mediaKeyForRef } from '@/lib/video-editor/media-previews'
import type { EditorClip, EditorMediaKind, MediaRef, VideoEditorMediaPreview } from '@/lib/video-editor/types'

export type MediaLibrarySource = {
  id?: string
  name?: string
  filename?: string
  fileName?: string
  title?: string
  description?: string
  url?: string
  sourceUrl?: string
  previewUrl?: string
  downloadUrl?: string
  thumbnailUrl?: string
  mimeType?: string
  assetType?: string
  sourceCollection?: string
  source?: {
    kind?: string
    refId?: string
    url?: string
    previewUrl?: string
    downloadUrl?: string
    thumbnailUrl?: string
    storagePath?: string
    mimeType?: string
    altText?: string
    referenceRole?: string
  }
}

function sourceUrl(source: MediaLibrarySource): string {
  return source.source?.url
    ?? source.source?.previewUrl
    ?? source.source?.downloadUrl
    ?? source.url
    ?? source.sourceUrl
    ?? source.previewUrl
    ?? source.downloadUrl
    ?? ''
}

function sourceThumbnail(source: MediaLibrarySource): string {
  return source.source?.thumbnailUrl ?? source.thumbnailUrl ?? sourceUrl(source)
}

function sourceMime(source: MediaLibrarySource): string {
  return source.source?.mimeType ?? source.mimeType ?? ''
}

function sourceTitle(source: MediaLibrarySource): string {
  return source.title
    ?? source.name
    ?? source.filename
    ?? source.fileName
    ?? source.source?.altText
    ?? source.source?.refId
    ?? source.id
    ?? 'Source media'
}

function sourceKindLabel(source: MediaLibrarySource): string {
  const fallback = [source.source?.kind ?? source.assetType ?? source.sourceCollection, source.source?.referenceRole]
    .filter(Boolean)
    .join(' / ')
  return source.description ?? (fallback || 'Source media')
}

function inferKind(source: MediaLibrarySource): EditorMediaKind {
  const mime = sourceMime(source)
  const url = `${sourceUrl(source)} ${source.source?.storagePath ?? ''}`
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(url)) return 'audio'
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return 'image'
  return 'video'
}

function sourceRefId(source: MediaLibrarySource): string {
  const refId = source.source?.refId ?? source.id ?? ''
  return refId.includes(':') ? refId.split(':').pop() ?? refId : refId
}

function toMediaRef(source: MediaLibrarySource, url: string, mediaKind: EditorMediaKind): MediaRef | null {
  const refId = sourceRefId(source)
  const kind = source.source?.kind ?? (source.sourceCollection === 'uploads' ? 'upload' : source.sourceCollection === 'youtube_source_assets' ? 'youtube_asset' : '')
  if (!refId) return null
  if (kind === 'upload') return { type: 'upload', fileId: refId, url, mediaKind }
  if (kind === 'youtube_asset') return { type: 'youtube_source_asset', sourceAssetId: refId, url, mediaKind }
  return { type: 'upload', fileId: refId, url, mediaKind }
}

export function MediaLibraryPanel({
  orgId,
  sources,
  mediaPreviews,
  onRefresh,
  onAddClip,
  onSourceUploaded,
}: {
  orgId?: string
  sources: MediaLibrarySource[]
  mediaPreviews?: Record<string, VideoEditorMediaPreview>
  onRefresh: () => void | Promise<void>
  onAddClip: (clip: EditorClip) => void
  onSourceUploaded?: (source: MediaLibrarySource) => void
}) {
  const [uploadState, setUploadState] = useState<{ status: 'idle' | 'uploading' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  })

  async function upload(file: File) {
    if (!orgId) {
      setUploadState({ status: 'error', message: 'Choose an organisation before uploading media.' })
      return
    }
    const form = new FormData()
    form.set('file', file)
    form.set('folder', `video-editor/${orgId || 'workspace'}/imports`)
    form.set('orgId', orgId)
    setUploadState({ status: 'uploading', message: `Uploading ${file.name}...` })
    try {
      const res = await fetch(scopedApiPath('/api/v1/creative-canvas/sources/upload', { orgId }), { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Upload failed')
      const uploadedSource = body.data?.source ?? body.source
      if (uploadedSource) onSourceUploaded?.(uploadedSource as MediaLibrarySource)
      setUploadState({ status: 'success', message: `Uploaded ${file.name}. It is available below while the library refreshes.` })
      await onRefresh()
    } catch (error) {
      setUploadState({ status: 'error', message: error instanceof Error ? error.message : 'Upload failed' })
    }
  }

  return (
    <section className="pib-card-section space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-headline text-lg font-semibold text-on-surface">Media</h2>
        <button type="button" className="pib-btn-ghost text-sm" onClick={onRefresh}>Refresh</button>
      </div>
      <label className="block rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-sm text-on-surface-variant">
        Upload media
        <input className="mt-2 block w-full text-xs" type="file" accept="video/*,audio/*,image/*" disabled={!orgId || uploadState.status === 'uploading'} onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.currentTarget.value = ''
        }} />
        {uploadState.message ? (
          <span
            role="status"
            className={[
              'mt-2 block text-xs',
              uploadState.status === 'error' ? 'text-red-300' : 'text-on-surface-variant',
            ].join(' ')}
          >
            {uploadState.message}
          </span>
        ) : null}
      </label>
      <div className="space-y-2">
        {sources.length === 0 ? <p className="text-sm text-on-surface-variant">No media in the source library yet.</p> : null}
        {sources.slice(0, 20).map((source) => {
          const url = sourceUrl(source)
          const mediaKind = inferKind(source)
          const title = sourceTitle(source)
          const thumbnail = sourceThumbnail(source)
          const media = url ? toMediaRef(source, url, mediaKind) : null
          const disabledReason = !url
            ? 'No client-readable URL is available yet. Refresh the library or wait for processing to finish.'
            : !media
              ? 'This source cannot be added to the video editor yet.'
              : ''
          return (
            <button
              key={source.id ?? url ?? title}
              type="button"
              className="w-full rounded-lg border border-[var(--color-pib-line)] p-3 text-left text-sm hover:border-[var(--color-pib-primary)] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={!media}
              title={disabledReason || `Add ${title} to the timeline`}
              onClick={() => onAddClip({
                id: `clip-${Date.now().toString(36)}`,
                timelineStart: 0,
                duration: 5,
                media: media ?? undefined,
              })}
            >
              <span className="flex items-start gap-3">
                {thumbnail && mediaKind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbnail} alt="" className="h-12 w-16 rounded-md object-cover" />
                ) : (
                  <span className="grid h-12 w-16 shrink-0 place-items-center rounded-md bg-white/[0.06] text-xs uppercase text-on-surface-variant">{mediaKind}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-on-surface">{title}</span>
                  <span className="block truncate text-xs text-on-surface-variant">{sourceKindLabel(source)}</span>
                  {(() => {
                    if (!media || mediaKind === 'image') return null
                    const preview = mediaPreviews?.[mediaKeyForRef(media)]
                    if (!preview) return null
                    const chip = preview.proxy
                      ? { label: 'Proxy ready', className: 'text-emerald-300 border-emerald-300/40' }
                      : preview.status === 'pending' || preview.status === 'processing'
                        ? { label: 'Preparing preview…', className: 'text-amber-200 border-amber-200/40' }
                        : { label: 'Original', className: 'text-on-surface-variant border-[var(--color-pib-line)]' }
                    return (
                      <span data-testid={`proxy-chip-${source.id ?? ''}`} className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${chip.className}`}>
                        {chip.label}
                      </span>
                    )
                  })()}
                  {disabledReason ? <span className="mt-1 block text-xs text-amber-200">{disabledReason}</span> : null}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
