'use client'

import { useMemo, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { GlassBar } from '@/components/ui/HudChip'
import { mediaKeyForRef } from '@/lib/video-editor/media-previews'
import type { StockResult } from '@/lib/video-editor/stock'
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

type MediaLibraryTab = 'uploads' | 'source_assets' | 'marketing' | 'stock' | 'generate'
type StockSearchKind = 'all' | 'image' | 'video'
type GenerateKind = 'image' | 'video'

type CreativeCanvasRunResponse = {
  data?: {
    pending?: boolean
    run?: {
      id?: string
      canvasId?: string
      nodeId?: string
      status?: string
      output?: { url?: string; thumbnailUrl?: string; outputNodeId?: string }
      error?: { code?: string; message?: string }
    }
    node?: {
      id?: string
      output?: { url?: string; thumbnailUrl?: string; kind?: string }
    }
    canvas?: { id?: string }
    runs?: Array<{
      id?: string
      nodeId?: string
      status?: string
      output?: { url?: string; thumbnailUrl?: string; outputNodeId?: string }
      error?: { code?: string; message?: string }
    }>
  }
  error?: string
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

function sourceTab(source: MediaLibrarySource): Exclude<MediaLibraryTab, 'stock' | 'generate'> {
  const kind = source.source?.kind ?? source.sourceCollection ?? source.assetType ?? ''
  if (kind === 'youtube_asset' || kind === 'youtube_source_assets') return 'source_assets'
  if (kind === 'canvas_output' || kind === 'creative_canvas' || kind === 'marketing_studio') return 'marketing'
  return 'uploads'
}

function clipFromMedia(media: MediaRef, duration = 5): EditorClip {
  return {
    id: `clip-${Date.now().toString(36)}`,
    timelineStart: 0,
    duration,
    media,
  }
}

function friendlyRunError(code?: string, message?: string): string {
  if (message) return message
  if (code === 'connection_required') return 'Connect the creative provider before generating media.'
  if (code === 'insufficient_credits') return 'Creative canvas credits are not available for this generation.'
  return 'Generation failed'
}

export function MediaLibraryPanel({
  orgId,
  projectId,
  canvasId,
  sources,
  mediaPreviews,
  onRefresh,
  onAddClip,
  onSourceUploaded,
}: {
  orgId?: string
  projectId?: string
  canvasId?: string
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
  const defaultSourceTab = useMemo<MediaLibraryTab>(() => {
    if (sources.some((source) => sourceTab(source) === 'uploads')) return 'uploads'
    if (sources.some((source) => sourceTab(source) === 'source_assets')) return 'source_assets'
    if (sources.some((source) => sourceTab(source) === 'marketing')) return 'marketing'
    return 'uploads'
  }, [sources])
  const [selectedTab, setSelectedTab] = useState<MediaLibraryTab | null>(null)
  const activeTab = selectedTab ?? defaultSourceTab
  const [stockQuery, setStockQuery] = useState('')
  const [stockKind, setStockKind] = useState<StockSearchKind>('all')
  const [stockResults, setStockResults] = useState<StockResult[]>([])
  const [stockBusy, setStockBusy] = useState(false)
  const [stockImportingIds, setStockImportingIds] = useState<Record<string, boolean>>({})
  const [stockImportErrors, setStockImportErrors] = useState<Record<string, string>>({})
  const [stockMessage, setStockMessage] = useState('')
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [generateKind, setGenerateKind] = useState<GenerateKind>('image')
  const [generateDuration, setGenerateDuration] = useState(4)
  const [generateBusy, setGenerateBusy] = useState(false)
  const [generateMessage, setGenerateMessage] = useState('')

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

  async function searchStock() {
    if (!orgId) {
      setStockMessage('Choose an organisation before searching stock.')
      return
    }
    if (!stockQuery.trim()) {
      setStockMessage('Enter a stock search term.')
      return
    }
    setStockBusy(true)
    setStockMessage('')
    try {
      const params = new URLSearchParams({ q: stockQuery.trim(), kind: stockKind, page: '1' })
      const res = await fetch(scopedApiPath(`/api/v1/video-editor/stock/search?${params.toString()}`, { orgId }))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Stock search failed')
      setStockResults((body.data?.results ?? []) as StockResult[])
      if (!(body.data?.results ?? []).length) setStockMessage('No stock results found.')
    } catch (error) {
      setStockMessage(error instanceof Error ? error.message : 'Stock search failed')
    } finally {
      setStockBusy(false)
    }
  }

  async function importStock(result: StockResult) {
    if (!orgId) return
    setStockImportingIds((current) => ({ ...current, [result.id]: true }))
    setStockImportErrors((current) => ({ ...current, [result.id]: '' }))
    setStockMessage('')
    try {
      const res = await fetch(scopedApiPath('/api/v1/video-editor/stock/import', { orgId }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, result }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Stock import failed')
      const upload = body.data?.upload as { fileId?: string; url?: string; mediaKind?: EditorMediaKind } | undefined
      if (!upload?.fileId || !upload.url || (upload.mediaKind !== 'image' && upload.mediaKind !== 'video')) throw new Error('Imported stock media was incomplete')
      onAddClip(clipFromMedia({ type: 'upload', fileId: upload.fileId, url: upload.url, mediaKind: upload.mediaKind }))
      setStockMessage(`Added ${result.title} to the timeline.`)
      await onRefresh()
    } catch (error) {
      setStockImportErrors((current) => ({
        ...current,
        [result.id]: error instanceof Error ? error.message : 'Stock import failed',
      }))
    } finally {
      setStockImportingIds((current) => {
        const next = { ...current }
        delete next[result.id]
        return next
      })
    }
  }

  function insertGeneratedMedia(canvasId: string, runId: string, nodeId: string, url: string, mediaKind: GenerateKind) {
    onAddClip(clipFromMedia({
      type: 'canvas_output',
      canvasId,
      nodeId,
      runId,
      url,
      mediaKind,
    }))
  }

  async function pollGeneratedOutput(canvasId: string, runId: string, mediaKind: GenerateKind) {
    if (!orgId) return false
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000))
      const res = await fetch(scopedApiPath(`/api/v1/creative-canvas/${canvasId}/runs`, { orgId }))
      const body = await res.json().catch(() => ({})) as CreativeCanvasRunResponse
      if (!res.ok) throw new Error(body.error ?? 'Generation status check failed')
      const run = body.data?.runs?.find((item) => item.id === runId)
      if (run?.output?.url) {
        insertGeneratedMedia(canvasId, run.id ?? runId, run.output.outputNodeId ?? run.nodeId ?? 'generated-output', run.output.url, mediaKind)
        return true
      }
      if (run?.status === 'failed') throw new Error(friendlyRunError(run.error?.code, run.error?.message))
    }
    return false
  }

  async function generateMedia() {
    if (!orgId) {
      setGenerateMessage('Choose an organisation before generating media.')
      return
    }
    if (!canvasId) {
      setGenerateMessage(projectId ? 'This editor project is not linked to a Creative Canvas yet.' : 'Open a saved editor project before generating media.')
      return
    }
    if (!generatePrompt.trim()) {
      setGenerateMessage('Describe the media you need before generating.')
      return
    }
    setGenerateBusy(true)
    setGenerateMessage('')
    try {
      const nodeId = `video-editor-generator-${Date.now().toString(36)}`
      const model = generateKind === 'video' ? 'cinematic_studio_video_3_5' : 'text2image_soul_v2'
      const res = await fetch(scopedApiPath(`/api/v1/creative-canvas/${canvasId}/runs/generate`, { orgId }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId,
          sourceNodeIds: [nodeId],
          model,
          prompt: generatePrompt.trim(),
          aspectRatio: '16:9',
          resolution: generateKind === 'video' ? '1080p' : '1024x576',
          quality: 'standard',
          duration: generateKind === 'video' ? generateDuration : undefined,
          batch: 1,
        }),
      })
      const body = await res.json().catch(() => ({})) as CreativeCanvasRunResponse
      if (!res.ok) throw new Error(body.error ?? 'Generation failed')
      const run = body.data?.run
      const outputUrl = body.data?.node?.output?.url ?? run?.output?.url
      const runId = run?.id
      if (runId && outputUrl) {
        insertGeneratedMedia(canvasId, runId, body.data?.node?.id ?? run.output?.outputNodeId ?? run.nodeId ?? nodeId, outputUrl, generateKind)
        setGenerateMessage('Generated media added to the timeline.')
      } else if (runId && body.data?.pending) {
        setGenerateMessage('Generation queued. Waiting for output...')
        const inserted = await pollGeneratedOutput(canvasId, runId, generateKind)
        setGenerateMessage(inserted ? 'Generated media added to the timeline.' : 'Generation is still running. Check Creative Canvas for the output.')
      } else {
        setGenerateMessage('Generation queued. Check Creative Canvas for the output.')
      }
    } catch (error) {
      setGenerateMessage(error instanceof Error ? error.message : 'Generation failed')
    } finally {
      setGenerateBusy(false)
    }
  }

  const tabSources = sources.filter((source) => sourceTab(source) === activeTab)
  const sourceTabLabels: Array<{ id: MediaLibraryTab; label: string }> = [
    { id: 'uploads', label: 'Uploads' },
    { id: 'source_assets', label: 'Source assets' },
    { id: 'marketing', label: 'Marketing Studio' },
    { id: 'stock', label: 'Stock' },
    { id: 'generate', label: 'Generate' },
  ]
  const renderSourceList = () => (
    <div className="space-y-2">
      {tabSources.length === 0 ? <p className="text-sm text-[var(--color-pib-text-muted)]">No media in this tab yet.</p> : null}
      {tabSources.slice(0, 20).map((source) => {
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
            onClick={() => media ? onAddClip(clipFromMedia(media)) : undefined}
          >
            <span className="flex items-start gap-3">
              {thumbnail && mediaKind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnail} alt="" className="h-12 w-16 rounded-md object-cover" />
              ) : (
                <span className="grid h-12 w-16 shrink-0 place-items-center rounded-md bg-white/[0.06] text-xs uppercase text-[var(--color-pib-text-muted)]">{mediaKind}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-[var(--color-pib-text)]">{title}</span>
                <span className="block truncate text-xs text-[var(--color-pib-text-muted)]">{sourceKindLabel(source)}</span>
                {(() => {
                  if (!media || mediaKind === 'image') return null
                  const preview = mediaPreviews?.[mediaKeyForRef(media)]
                  if (!preview) return null
                  const chip = preview.proxy
                    ? { label: 'Proxy ready', className: 'text-emerald-300 border-emerald-300/40' }
                    : preview.status === 'pending' || preview.status === 'processing'
                      ? { label: 'Preparing preview...', className: 'text-[var(--sc-ink-soft)] border-amber-200/40' }
                      : { label: 'Original', className: 'text-[var(--color-pib-text-muted)] border-[var(--color-pib-line)]' }
                  return (
                    <span data-testid={`proxy-chip-${source.id ?? ''}`} className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${chip.className}`}>
                      {chip.label}
                    </span>
                  )
                })()}
                {disabledReason ? <span className="mt-1 block text-xs text-[var(--sc-ink-soft)]">{disabledReason}</span> : null}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <section className="pib-card-section space-y-3 p-3" data-module-accent="cyan">
      <GlassBar className="items-center justify-between gap-2 p-2">
        <h2 className="text-sm text-[var(--color-pib-text)]">Media</h2>
        <button type="button" className="btn-pib-ghost btn-pib-sm font-label" onClick={onRefresh}>Refresh</button>
      </GlassBar>
      <div role="tablist" aria-label="Media source tabs" className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-pib-line)] p-1">
        {sourceTabLabels.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`rounded-md px-2 py-1 text-xs ${activeTab === tab.id ? 'bg-[var(--color-pib-line)]  text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)]'}`}
            onClick={() => setSelectedTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'uploads' ? (
        <>
          <label className="block rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-sm text-[var(--color-pib-text-muted)]">
            Upload media
            <input className="mt-2 block w-full text-xs" type="file" accept="video/*,audio/*,image/*" disabled={!orgId || uploadState.status === 'uploading'} onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void upload(file)
              event.currentTarget.value = ''
            }}  aria-label="Upload file"/>
            {uploadState.message ? (
              <span
                role="status"
                className={[
                  'mt-2 block text-xs',
                  uploadState.status === 'error' ? 'text-red-300' : 'text-[var(--color-pib-text-muted)]',
                ].join(' ')}
              >
                {uploadState.message}
              </span>
            ) : null}
          </label>
          {renderSourceList()}
        </>
      ) : null}
      {activeTab === 'source_assets' || activeTab === 'marketing' ? renderSourceList() : null}
      {activeTab === 'stock' ? (
        <div className="space-y-3">
          <div className="grid gap-2">
            <input
              className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm text-[var(--color-pib-text)]"
              placeholder="Search stock"
              value={stockQuery}
              onChange={(event) => setStockQuery(event.target.value)}
             aria-label="Search stock"/>
            <label className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
              Stock kind
              <select
                className="mt-1 w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-2 text-sm normal-case text-[var(--color-pib-text)]"
                value={stockKind}
                onChange={(event) => setStockKind(event.target.value as StockSearchKind)}
               aria-label="Input">
                <option value="all">All</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
              </select>
            </label>
            <button type="button" className="btn-pib-primary btn-pib-sm font-label" disabled={stockBusy || !orgId} onClick={() => void searchStock()}>
              {stockBusy ? 'Searching...' : 'Search'}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {stockResults.map((result) => (
              <article key={result.id} className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm">
                <div className="flex gap-3 sm:block">
                  {result.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.thumbnailUrl} alt="" className="h-14 w-20 rounded-md object-cover sm:h-24 sm:w-full" />
                  ) : (
                    <span className="grid h-14 w-20 place-items-center rounded-md bg-white/[0.06] text-xs uppercase text-[var(--color-pib-text-muted)] sm:h-24 sm:w-full">{result.mediaKind}</span>
                  )}
                  <div className="min-w-0 flex-1 sm:mt-2">
                    <h3 className="truncate font-medium text-[var(--color-pib-text)]">{result.title}</h3>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">{result.attribution}</p>
                    <button type="button" className="pib-btn-ghost mt-2 text-xs" disabled={stockImportingIds[result.id]} onClick={() => void importStock(result)}>
                      {stockImportingIds[result.id] ? 'Adding...' : 'Add to project'}
                    </button>
                    {stockImportErrors[result.id] ? <p className="mt-2 text-xs text-red-300">{stockImportErrors[result.id]}</p> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {stockMessage ? <p role="status" className="text-xs text-[var(--color-pib-text-muted)]">{stockMessage}</p> : null}
        </div>
      ) : null}
      {activeTab === 'generate' ? (
        <div className="space-y-3">
          <textarea
            className="min-h-24 w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm text-[var(--color-pib-text)]"
            placeholder="Describe the B-roll you need..."
            value={generatePrompt}
            onChange={(event) => setGeneratePrompt(event.target.value)}
           aria-label="Describe the B-roll you need..."/>
          <label className="block text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
            Image or video
            <select
              aria-label="Image or video"
              className="mt-1 w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-2 text-sm normal-case text-[var(--color-pib-text)]"
              value={generateKind}
              onChange={(event) => setGenerateKind(event.target.value as GenerateKind)}
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </label>
          {generateKind === 'video' ? (
            <label className="block text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
              Duration
              <select
                className="mt-1 w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-2 text-sm normal-case text-[var(--color-pib-text)]"
                value={generateDuration}
                onChange={(event) => setGenerateDuration(Number(event.target.value))}
               aria-label="Input">
                <option value={4}>4 seconds</option>
                <option value={8}>8 seconds</option>
              </select>
            </label>
          ) : null}
          <button type="button" className="btn-pib-primary btn-pib-sm font-label" disabled={generateBusy || !orgId} onClick={() => void generateMedia()}>
            {generateBusy ? 'Generating...' : 'Generate'}
          </button>
          {!canvasId ? <p className="text-xs text-[var(--sc-ink-soft)]">This editor project is not linked to a Creative Canvas yet.</p> : null}
          {generateMessage ? <p role="status" className="text-xs text-[var(--color-pib-text-muted)]">{generateMessage}</p> : null}
        </div>
      ) : null}
    </section>
  )
}
