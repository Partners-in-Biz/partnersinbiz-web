'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  YouTubeAnalyticsSnapshot,
  YouTubeChannelWorkspace,
  YouTubeClipCandidate,
  YouTubeProductionDraft,
  YouTubePublishingPacket,
  YouTubeRenderJob,
  YouTubeReleasePlan,
  YouTubeSeries,
  YouTubeSourceAsset,
  YouTubeVideoProject,
} from '@/lib/youtube-studio/types'
import { YouTubeChannelCard, YouTubeVideoCard } from '@/components/youtube-studio/YouTubeStudioCards'
import { YouTubeStudioWorkspaceShell } from '@/components/youtube-studio/YouTubeStudioWorkspaceShell'
import { scopedApiPath } from '@/lib/portal/scoped-routing'

interface YouTubeStudioPortalWorkspaceProps {
  orgId?: string | null
}

type RequestForm = {
  channelWorkspaceId: string
  title: string
  objective: string
  sourceUrl: string
}

const emptyRequest: RequestForm = {
  channelWorkspaceId: '',
  title: '',
  objective: '',
  sourceUrl: '',
}

function isClientReviewOpen(video: YouTubeVideoProject) {
  return (
    video.status === 'client_review' ||
    video.status === 'changes_requested' ||
    video.clientReview?.status === 'requested'
  )
}

export function YouTubeStudioPortalWorkspace({ orgId }: YouTubeStudioPortalWorkspaceProps = {}) {
  const [channels, setChannels] = useState<YouTubeChannelWorkspace[]>([])
  const [series, setSeries] = useState<YouTubeSeries[]>([])
  const [videos, setVideos] = useState<YouTubeVideoProject[]>([])
  const [packets, setPackets] = useState<YouTubePublishingPacket[]>([])
  const [releasePlans, setReleasePlans] = useState<YouTubeReleasePlan[]>([])
  const [sourceAssets, setSourceAssets] = useState<YouTubeSourceAsset[]>([])
  const [clipCandidates, setClipCandidates] = useState<YouTubeClipCandidate[]>([])
  const [productionDrafts, setProductionDrafts] = useState<YouTubeProductionDraft[]>([])
  const [renderJobs, setRenderJobs] = useState<YouTubeRenderJob[]>([])
  const [analytics, setAnalytics] = useState<YouTubeAnalyticsSnapshot[]>([])
  const [request, setRequest] = useState<RequestForm>(emptyRequest)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [packetNotes, setPacketNotes] = useState<Record<string, string>>({})
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const [renderNotes, setRenderNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewingPacketId, setReviewingPacketId] = useState<string | null>(null)
  const [reviewingDraftId, setReviewingDraftId] = useState<string | null>(null)
  const [reviewingRenderId, setReviewingRenderId] = useState<string | null>(null)
  const [loadNotice, setLoadNotice] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [moduleDisabled, setModuleDisabled] = useState(false)
  const submittingRequestRef = useRef(false)
  const reviewingIdRef = useRef<string | null>(null)
  const reviewingPacketIdRef = useRef<string | null>(null)
  const reviewingDraftIdRef = useRef<string | null>(null)
  const reviewingRenderIdRef = useRef<string | null>(null)
  const loadRequestIdRef = useRef(0)

  const apiPath = useMemo(() => scopedApiPath('/api/v1/portal/youtube-studio', { orgId }), [orgId])
  const activeApiPathRef = useRef(apiPath)
  const previousApiPathRef = useRef(apiPath)
  activeApiPathRef.current = apiPath
  const notice = loadNotice || actionNotice

  const load = useCallback(async () => {
    if (apiPath !== activeApiPathRef.current) return
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const isCurrentRequest = () => requestId === loadRequestIdRef.current && apiPath === activeApiPathRef.current
    setLoading(true)
    try {
      const res = await fetch(apiPath)
      const body = await res.json().catch(() => ({}))
      if (!isCurrentRequest()) return
      if (!res.ok && body.moduleDisabled === true) {
        setModuleDisabled(true)
        setChannels([])
        setSeries([])
        setVideos([])
        setPackets([])
        setReleasePlans([])
        setSourceAssets([])
        setClipCandidates([])
        setProductionDrafts([])
        setRenderJobs([])
        setAnalytics([])
        setLoadNotice('')
        setActionNotice('')
        return
      }

      setModuleDisabled(false)
      setChannels(Array.isArray(body.data?.channels) ? body.data.channels : [])
      setSeries(Array.isArray(body.data?.series) ? body.data.series : [])
      setVideos(Array.isArray(body.data?.videos) ? body.data.videos : [])
      setPackets(Array.isArray(body.data?.packets) ? body.data.packets : [])
      setReleasePlans(Array.isArray(body.data?.releasePlans) ? body.data.releasePlans : [])
      setSourceAssets(Array.isArray(body.data?.sourceAssets) ? body.data.sourceAssets : [])
      setClipCandidates(Array.isArray(body.data?.clipCandidates) ? body.data.clipCandidates : [])
      setProductionDrafts(Array.isArray(body.data?.productionDrafts) ? body.data.productionDrafts : [])
      setRenderJobs(Array.isArray(body.data?.renderJobs) ? body.data.renderJobs : [])
      setAnalytics(Array.isArray(body.data?.analytics) ? body.data.analytics : [])
      if (!res.ok) {
        setLoadNotice(body.error ?? 'Could not load YouTube Studio.')
      } else {
        setLoadNotice('')
      }
    } catch {
      if (!isCurrentRequest()) return
      setModuleDisabled(false)
      setChannels([])
      setSeries([])
      setVideos([])
      setPackets([])
      setReleasePlans([])
      setSourceAssets([])
      setClipCandidates([])
      setProductionDrafts([])
      setRenderJobs([])
      setAnalytics([])
      setLoadNotice('Could not load YouTube Studio.')
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
      }
    }
  }, [apiPath])

  useEffect(() => {
    if (previousApiPathRef.current === apiPath) return
    previousApiPathRef.current = apiPath
    submittingRequestRef.current = false
    reviewingIdRef.current = null
    reviewingPacketIdRef.current = null
    reviewingDraftIdRef.current = null
    reviewingRenderIdRef.current = null
    setRequest(emptyRequest)
    setReviewNotes({})
    setPacketNotes({})
    setDraftNotes({})
    setRenderNotes({})
    setSubmittingRequest(false)
    setReviewingId(null)
    setReviewingPacketId(null)
    setReviewingDraftId(null)
    setReviewingRenderId(null)
    setLoadNotice('')
    setActionNotice('')
  }, [apiPath])

  useEffect(() => {
    void load()
    return () => {
      loadRequestIdRef.current += 1
    }
  }, [load])

  function update<K extends keyof RequestForm>(field: K, value: RequestForm[K]) {
    setRequest((prev) => ({ ...prev, [field]: value }))
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault()
    if (submittingRequestRef.current || !request.channelWorkspaceId || !request.title.trim()) return
    const mutationApiPath = apiPath
    const isCurrentMutation = () => mutationApiPath === activeApiPathRef.current
    submittingRequestRef.current = true
    setSubmittingRequest(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch(mutationApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not submit video request')
        return
      }
      setRequest(emptyRequest)
      setActionNotice('Video request sent to the PiB team.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not submit video request')
      }
    } finally {
      if (isCurrentMutation()) {
        submittingRequestRef.current = false
        setSubmittingRequest(false)
      }
    }
  }

  async function saveDecision(videoId: string, decision: 'approved' | 'changes_requested' | 'rejected') {
    if (reviewingIdRef.current) return
    const mutationApiPath = apiPath
    const isCurrentMutation = () => mutationApiPath === activeApiPathRef.current
    reviewingIdRef.current = videoId
    setReviewingId(videoId)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch(mutationApiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: videoId, decision, notes: reviewNotes[videoId] ?? '' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not save review')
        return
      }
      setActionNotice('Review saved for the PiB team.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not save review')
      }
    } finally {
      if (isCurrentMutation()) {
        reviewingIdRef.current = null
        setReviewingId(null)
      }
    }
  }

  async function savePacketDecision(packetId: string, decision: 'approved' | 'changes_requested' | 'rejected') {
    if (reviewingPacketIdRef.current) return
    const mutationApiPath = apiPath
    const isCurrentMutation = () => mutationApiPath === activeApiPathRef.current
    reviewingPacketIdRef.current = packetId
    setReviewingPacketId(packetId)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch(mutationApiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packetId, decision, notes: packetNotes[packetId] ?? '' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not save publishing packet decision')
        return
      }
      setActionNotice('Publishing packet decision saved for the PiB team.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not save publishing packet decision')
      }
    } finally {
      if (isCurrentMutation()) {
        reviewingPacketIdRef.current = null
        setReviewingPacketId(null)
      }
    }
  }

  async function saveDraftDecision(productionDraftId: string, decision: 'approved' | 'changes_requested' | 'rejected') {
    if (reviewingDraftIdRef.current) return
    const mutationApiPath = apiPath
    const isCurrentMutation = () => mutationApiPath === activeApiPathRef.current
    reviewingDraftIdRef.current = productionDraftId
    setReviewingDraftId(productionDraftId)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch(mutationApiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productionDraftId, decision, notes: draftNotes[productionDraftId] ?? '' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not save production draft decision')
        return
      }
      setActionNotice('Production draft decision saved for the PiB team.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not save production draft decision')
      }
    } finally {
      if (isCurrentMutation()) {
        reviewingDraftIdRef.current = null
        setReviewingDraftId(null)
      }
    }
  }

  async function saveRenderDecision(renderJobId: string, decision: 'approved' | 'changes_requested' | 'rejected') {
    if (reviewingRenderIdRef.current) return
    const mutationApiPath = apiPath
    const isCurrentMutation = () => mutationApiPath === activeApiPathRef.current
    reviewingRenderIdRef.current = renderJobId
    setReviewingRenderId(renderJobId)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch(mutationApiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renderJobId, decision, notes: renderNotes[renderJobId] ?? '' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not save render decision')
        return
      }
      setActionNotice('Render decision saved for the PiB team.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not save render decision')
      }
    } finally {
      if (isCurrentMutation()) {
        reviewingRenderIdRef.current = null
        setReviewingRenderId(null)
      }
    }
  }

  if (moduleDisabled) {
    return (
      <YouTubeStudioWorkspaceShell
        channels={[]}
        videos={[]}
        series={[]}
        surface="portal"
        eyebrow="Video production"
        title="YouTube Studio"
        description="YouTube production access is controlled by your PiB workspace settings."
        loading={loading}
        className="p-4 sm:p-6 lg:p-8"
      >
        <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-text)]">
          YouTube Studio is not enabled for this portal.
        </div>
      </YouTubeStudioWorkspaceShell>
    )
  }

  return (
    <YouTubeStudioWorkspaceShell
      channels={channels}
      videos={videos}
      series={series}
      surface="portal"
      eyebrow="Video production"
      title="YouTube Studio"
      description="Request videos, review drafts, approve changes, and see the YouTube work PiB is producing for your account."
      notice={notice}
      loading={loading}
      className="p-4 sm:p-6 lg:p-8"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          {channels.map((channel) => (
            <YouTubeChannelCard key={channel.id ?? channel.title} channel={channel} />
          ))}

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Video reviews</h2>
            {videos.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube videos yet.</div>
            ) : (
              videos.map((video) => (
                <YouTubeVideoCard key={video.id ?? video.title} video={video}>
                  {video.id && isClientReviewOpen(video) ? (
                    <div className="w-full space-y-3">
                      <textarea
                        rows={3}
                        disabled={reviewingId === video.id}
                        value={reviewNotes[video.id] ?? ''}
                        onChange={(event) => setReviewNotes((prev) => ({ ...prev, [video.id!]: event.target.value }))}
                        placeholder="Notes for PiB"
                        className="w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={Boolean(reviewingId)}
                          onClick={() => saveDecision(video.id!, 'approved')}
                          className="pib-btn-primary text-sm"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(reviewingId)}
                          onClick={() => saveDecision(video.id!, 'changes_requested')}
                          className="pib-btn-ghost text-sm"
                        >
                          Request changes
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(reviewingId)}
                          onClick={() => saveDecision(video.id!, 'rejected')}
                          className="pib-btn-ghost text-sm"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : null}
                </YouTubeVideoCard>
              ))
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Source assets</h2>
            {sourceAssets.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No source assets are visible yet.</div>
            ) : (
              sourceAssets.map((asset) => (
                <article key={asset.id ?? asset.title} className="pib-card-section space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-on-surface">{asset.title}</h3>
                      <p className="mt-1 text-sm text-on-surface-variant">{sourceAssetMeta(asset)}</p>
                    </div>
                  </div>
                  {asset.clientNotes ? <p className="break-words text-sm text-on-surface-variant">{asset.clientNotes}</p> : null}
                  {asset.rights?.status ? (
                    <p className="break-words text-xs text-on-surface-variant">rights: {formatToken(asset.rights.status)}</p>
                  ) : null}
                </article>
              ))
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Clip candidates</h2>
            {clipCandidates.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No clip candidates are visible yet.</div>
            ) : (
              clipCandidates.map((clip) => (
                <article key={clip.id ?? `${clip.sourceAssetId}-${clip.startSeconds}`} className="pib-card-section space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-on-surface">{clip.title}</h3>
                      <p className="mt-1 text-sm text-on-surface-variant">{clipMeta(clip)}</p>
                    </div>
                  </div>
                  {clip.summary ? <p className="break-words text-sm text-on-surface-variant">{clip.summary}</p> : null}
                  {clip.hook ? <p className="break-words text-sm text-on-surface-variant">{clip.hook}</p> : null}
                  {clip.transcriptExcerpt ? <p className="break-words text-xs text-on-surface-variant">{clip.transcriptExcerpt}</p> : null}
                  <div className="grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
                    {clipGateEntries(clip).map(([key, check]) => (
                      <span key={key} className="min-w-0 break-words">
                        {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
                      </span>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Production drafts</h2>
            {productionDrafts.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No production drafts are visible yet.</div>
            ) : (
              productionDrafts.map((draft) => (
                <article key={draft.id ?? `${draft.videoProjectId}-${draft.versionNumber}`} className="pib-card-section space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-on-surface">{draft.title}</h3>
                      <p className="mt-1 text-sm text-on-surface-variant">{productionDraftMeta(draft)}</p>
                    </div>
                  </div>
                  {draft.summary ? <p className="break-words text-sm text-on-surface-variant">{draft.summary}</p> : null}
                  {draft.hook ? <p className="break-words text-sm text-on-surface-variant">{draft.hook}</p> : null}
                  {draft.outline?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {draft.outline.slice(0, 6).map((item) => (
                        <span key={item} className="max-w-full break-words rounded-full bg-white/[0.04] px-2 py-1 text-xs text-on-surface-variant">
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {draft.scriptText ? <p className="break-words text-sm text-on-surface-variant">{draft.scriptText}</p> : null}
                  {draft.scenes?.length ? (
                    <div className="grid gap-2">
                      {draft.scenes.slice(0, 3).map((scene, index) => (
                        <div key={`${scene.label}-${index}`} className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm text-on-surface-variant">
                          <p className="font-medium text-on-surface">{productionSceneMeta(scene)}</p>
                          {scene.summary ? <p className="mt-1 break-words">{scene.summary}</p> : null}
                          {scene.voiceover ? <p className="mt-1 break-words">{scene.voiceover}</p> : null}
                          {scene.visualNotes ? <p className="mt-1 break-words">{scene.visualNotes}</p> : null}
                          {scene.onScreenText ? <p className="mt-1 break-words">{scene.onScreenText}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
                    {productionDraftGateEntries(draft).map(([key, check]) => (
                      <span key={key} className="min-w-0 break-words">
                        {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
                      </span>
                    ))}
                  </div>
                  {draft.clientNotes ? <p className="break-words text-sm text-on-surface-variant">{draft.clientNotes}</p> : null}
                  {draft.id && draft.status === 'client_review' ? (
                    <div className="space-y-3">
                      <textarea
                        rows={3}
                        disabled={reviewingDraftId === draft.id}
                        value={draftNotes[draft.id] ?? ''}
                        onChange={(event) => setDraftNotes((prev) => ({ ...prev, [draft.id!]: event.target.value }))}
                        placeholder="Draft notes for PiB"
                        className="w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={Boolean(reviewingDraftId)}
                          onClick={() => saveDraftDecision(draft.id!, 'approved')}
                          className="pib-btn-primary text-sm"
                        >
                          Approve draft
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(reviewingDraftId)}
                          onClick={() => saveDraftDecision(draft.id!, 'changes_requested')}
                          className="pib-btn-ghost text-sm"
                        >
                          Request draft changes
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(reviewingDraftId)}
                          onClick={() => saveDraftDecision(draft.id!, 'rejected')}
                          className="pib-btn-ghost text-sm"
                        >
                          Reject draft
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Render jobs</h2>
            {renderJobs.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No render jobs are visible yet.</div>
            ) : (
              renderJobs.map((job) => (
                <article key={job.id ?? `${job.videoProjectId}-${job.versionNumber}`} className="pib-card-section space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-on-surface">{job.title}</h3>
                      <p className="mt-1 text-sm text-on-surface-variant">{renderJobMeta(job)}</p>
                    </div>
                  </div>
                  {job.editBrief ? <p className="break-words text-sm text-on-surface-variant">{job.editBrief}</p> : null}
                  {job.timeline?.length ? (
                    <div className="grid gap-2">
                      {job.timeline.slice(0, 3).map((scene, index) => (
                        <div key={`${scene.label}-${index}`} className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm text-on-surface-variant">
                          <p className="font-medium text-on-surface">{renderTimelineMeta(scene)}</p>
                          {scene.summary ? <p className="mt-1 break-words">{scene.summary}</p> : null}
                          {scene.voiceover ? <p className="mt-1 break-words">{scene.voiceover}</p> : null}
                          {scene.onScreenText ? <p className="mt-1 break-words">{scene.onScreenText}</p> : null}
                          {scene.editNotes ? <p className="mt-1 break-words">{scene.editNotes}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
                    {renderJobGateEntries(job).map(([key, check]) => (
                      <span key={key} className="min-w-0 break-words">
                        {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
                      </span>
                    ))}
                  </div>
                  {job.output?.previewUrl || job.output?.downloadUrl ? (
                    <p className="break-words text-sm text-on-surface-variant">
                      {job.output.previewUrl ? 'preview ready' : 'download ready'}
                      {typeof job.output.durationSeconds === 'number' ? ` / ${job.output.durationSeconds}s` : ''}
                    </p>
                  ) : null}
                  {job.clientNotes ? <p className="break-words text-sm text-on-surface-variant">{job.clientNotes}</p> : null}
                  {job.id && job.status === 'qa_review' ? (
                    <div className="space-y-3">
                      <textarea
                        rows={3}
                        disabled={reviewingRenderId === job.id}
                        value={renderNotes[job.id] ?? ''}
                        onChange={(event) => setRenderNotes((prev) => ({ ...prev, [job.id!]: event.target.value }))}
                        placeholder="Render notes for PiB"
                        className="w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={Boolean(reviewingRenderId)}
                          onClick={() => saveRenderDecision(job.id!, 'approved')}
                          className="pib-btn-primary text-sm"
                        >
                          Approve render
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(reviewingRenderId)}
                          onClick={() => saveRenderDecision(job.id!, 'changes_requested')}
                          className="pib-btn-ghost text-sm"
                        >
                          Request render changes
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(reviewingRenderId)}
                          onClick={() => saveRenderDecision(job.id!, 'rejected')}
                          className="pib-btn-ghost text-sm"
                        >
                          Reject render
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Publishing packets</h2>
            {packets.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No publishing packets are ready for review yet.</div>
            ) : (
              packets.map((packet) => (
                <article key={packet.id ?? `${packet.videoProjectId}-${packet.versionNumber}`} className="pib-card-section space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-on-surface">{packetTitle(packet)}</h3>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        Version {packet.versionNumber || 1} / {formatToken(packet.status)} / {formatToken(packet.visibility)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                      {packet.chapters?.length ?? 0} chapters
                    </span>
                  </div>
                  {packet.description ? (
                    <p className="break-words text-sm text-on-surface-variant">{packet.description}</p>
                  ) : null}
                  {packet.tags?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {packet.tags.slice(0, 8).map((tag) => (
                        <span key={tag} className="max-w-full break-words rounded-full bg-white/[0.04] px-2 py-1 text-xs text-on-surface-variant">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
                    {packetGateEntries(packet).map(([key, check]) => (
                      <span key={key} className="min-w-0 break-words">
                        {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
                      </span>
                    ))}
                  </div>
                  {packet.id && packet.status === 'client_review' ? (
                    <div className="space-y-3">
                      <textarea
                        rows={3}
                        disabled={reviewingPacketId === packet.id}
                        value={packetNotes[packet.id] ?? ''}
                        onChange={(event) => setPacketNotes((prev) => ({ ...prev, [packet.id!]: event.target.value }))}
                        placeholder="Packet notes for PiB"
                        className="w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={Boolean(reviewingPacketId)}
                          onClick={() => savePacketDecision(packet.id!, 'approved')}
                          className="pib-btn-primary text-sm"
                        >
                          Approve packet
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(reviewingPacketId)}
                          onClick={() => savePacketDecision(packet.id!, 'changes_requested')}
                          className="pib-btn-ghost text-sm"
                        >
                          Request packet changes
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(reviewingPacketId)}
                          onClick={() => savePacketDecision(packet.id!, 'rejected')}
                          className="pib-btn-ghost text-sm"
                        >
                          Reject packet
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Release plans</h2>
            {releasePlans.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube release plans are visible yet.</div>
            ) : (
              releasePlans.map((plan) => (
                <article key={plan.id ?? `${plan.videoProjectId}-${plan.publishingPacketId}`} className="pib-card-section space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-on-surface">{plan.publicSummary || 'YouTube release plan'}</h3>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        {formatToken(plan.mode)} / {formatToken(plan.status)} / {formatToken(plan.targetVisibility)}
                      </p>
                    </div>
                    {plan.scheduledPublishAt ? (
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                        scheduled
                      </span>
                    ) : null}
                  </div>
                  {plan.scheduledPublishAt ? (
                    <p className="break-words text-sm text-on-surface-variant">scheduled for {String(plan.scheduledPublishAt)}</p>
                  ) : null}
                  <div className="grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
                    {releasePlanGateEntries(plan).map(([key, check]) => (
                      <span key={key} className="min-w-0 break-words">
                        {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
                      </span>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Analytics summaries</h2>
            {analytics.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No client-facing YouTube analytics summaries yet.</div>
            ) : (
              analytics.slice(0, 4).map((snapshot) => (
                <article key={snapshot.id ?? `${snapshot.channelWorkspaceId}-${snapshot.periodEnd}`} className="pib-card-section space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-on-surface">{snapshot.clientSummary || 'YouTube analytics update'}</h3>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        {snapshot.periodStart} to {snapshot.periodEnd} / {formatToken(snapshot.sourceFreshness)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                      {formatToken(snapshot.source)}
                    </span>
                  </div>
                  <div className="grid gap-2 text-sm text-on-surface-variant sm:grid-cols-4">
                    <Metric label="Views" value={snapshot.metrics?.views} />
                    <Metric label="Watch min" value={snapshot.metrics?.watchTimeMinutes} />
                    <Metric label="Avg viewed" value={snapshot.metrics?.averageViewPercentage} suffix="%" />
                    <Metric label="CTR" value={snapshot.metrics?.impressionsCtr} suffix="%" />
                  </div>
                  {snapshot.recommendations?.length ? (
                    <div className="space-y-2">
                      {snapshot.recommendations.slice(0, 2).map((recommendation, index) => (
                        <p key={`${recommendation.type}-${index}`} className="break-words text-sm text-on-surface-variant">
                          <span className="font-medium text-on-surface">{formatToken(recommendation.type)}:</span> {recommendation.summary}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>

        <form onSubmit={submitRequest} className="pib-card-section h-fit space-y-4 p-5 lg:sticky lg:top-6">
          <h2 className="font-headline font-bold text-on-surface">Request a video</h2>
          <label className="block text-sm">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Channel</span>
            <select
              value={request.channelWorkspaceId}
              onChange={(event) => update('channelWorkspaceId', event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            >
              <option value="">Select a channel</option>
              {channels.map((channel) => (
                <option key={channel.id ?? channel.title} value={channel.id ?? ''}>{channel.title}</option>
              ))}
            </select>
          </label>
          <Field label="Video title" value={request.title} onChange={(value) => update('title', value)} required />
          <TextArea label="Objective" value={request.objective} onChange={(value) => update('objective', value)} />
          <Field label="Source URL" value={request.sourceUrl} onChange={(value) => update('sourceUrl', value)} />
          <button type="submit" disabled={submittingRequest || !request.channelWorkspaceId || !request.title.trim()} className="pib-btn-primary w-full">
            {submittingRequest ? 'Sending...' : 'Send request'}
          </button>
        </form>
      </div>
    </YouTubeStudioWorkspaceShell>
  )
}

function Metric({ label, value, suffix = '' }: { label: string; value?: number; suffix?: string }) {
  return (
    <span className="min-w-0 break-words">
      {label}: {value === undefined ? 'not set' : `${value}${suffix}`}
    </span>
  )
}

function sourceAssetMeta(asset: YouTubeSourceAsset) {
  const parts = [formatToken(asset.assetType), formatToken(asset.status)]
  if (typeof asset.durationSeconds === 'number') parts.push(`${asset.durationSeconds}s`)
  return parts.join(' / ')
}

function clipMeta(clip: YouTubeClipCandidate) {
  return `${clip.startSeconds}s-${clip.endSeconds}s / ${formatToken(clip.targetFormat)} / ${formatToken(clip.status)}`
}

function clipGateEntries(clip: YouTubeClipCandidate) {
  return Object.entries(clip.checks ?? {}) as Array<[
    keyof YouTubeClipCandidate['checks'],
    YouTubeClipCandidate['checks'][keyof YouTubeClipCandidate['checks']],
  ]>
}

function productionDraftMeta(draft: YouTubeProductionDraft) {
  return `${formatToken(draft.draftType)} / ${formatToken(draft.status)} / v${draft.versionNumber || 1}`
}

function productionSceneMeta(scene: YouTubeProductionDraft['scenes'][number]) {
  const parts = [scene.label]
  if (typeof scene.targetSeconds === 'number') parts.push(`${scene.targetSeconds}s`)
  return parts.join(' / ')
}

function productionDraftGateEntries(draft: YouTubeProductionDraft) {
  return Object.entries(draft.checks ?? {}) as Array<[
    keyof YouTubeProductionDraft['checks'],
    YouTubeProductionDraft['checks'][keyof YouTubeProductionDraft['checks']],
  ]>
}

function renderJobMeta(job: YouTubeRenderJob) {
  return `${formatToken(job.renderType)} / ${formatToken(job.status)} / ${formatToken(job.targetFormat)}`
}

function renderTimelineMeta(scene: YouTubeRenderJob['timeline'][number]) {
  const hasStart = typeof scene.startSeconds === 'number'
  const hasEnd = typeof scene.endSeconds === 'number'
  const range = hasStart && hasEnd ? `${scene.startSeconds}s-${scene.endSeconds}s` : null
  return [scene.label, range].filter(Boolean).join(' / ')
}

function renderJobGateEntries(job: YouTubeRenderJob) {
  return Object.entries(job.checks ?? {}) as Array<[
    keyof YouTubeRenderJob['checks'],
    YouTubeRenderJob['checks'][keyof YouTubeRenderJob['checks']],
  ]>
}

function formatToken(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase()
}

function packetTitle(packet: YouTubePublishingPacket) {
  return packet.titleOptions?.find((option) => option.selected)?.text ?? packet.titleOptions?.[0]?.text ?? 'Publishing packet'
}

function packetGateEntries(packet: YouTubePublishingPacket) {
  return Object.entries(packet.checks ?? {}) as Array<[
    keyof YouTubePublishingPacket['checks'],
    YouTubePublishingPacket['checks'][keyof YouTubePublishingPacket['checks']],
  ]>
}

function releasePlanGateEntries(plan: YouTubeReleasePlan) {
  return Object.entries(plan.checks ?? {}) as Array<[
    keyof YouTubeReleasePlan['checks'],
    YouTubeReleasePlan['checks'][keyof YouTubeReleasePlan['checks']],
  ]>
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <input
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      />
    </label>
  )
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      />
    </label>
  )
}
