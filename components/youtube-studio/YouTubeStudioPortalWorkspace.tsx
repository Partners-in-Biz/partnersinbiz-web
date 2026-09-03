'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { YouTubeStudioGuide } from '@/components/youtube-studio/YouTubeStudioGuide'
import { YouTubeStudioOAuthReturnHandler } from '@/components/youtube-studio/YouTubeStudioOAuthReturnHandler'
import { YouTubeStudioWorkspaceShell } from '@/components/youtube-studio/YouTubeStudioWorkspaceShell'
import { YouTubeStudioChannelHeader } from '@/components/youtube-studio/YouTubeStudioChannelHeader'
import { YouTubeStudioWorkQueue } from '@/components/youtube-studio/YouTubeStudioWorkQueue'
import { YouTubeStudioDetailsTabs } from '@/components/youtube-studio/YouTubeStudioDetailsTabs'
import { VideoEditorProjectList } from '@/components/video-editor/VideoEditorProjectList'
import { buildWorkQueue, filterWorkQueueByChannel, type WorkQueueItem } from '@/lib/youtube-studio/work-queue'
import { appendQueryParams, scopedApiPath } from '@/lib/portal/scoped-routing'

interface YouTubeStudioPortalWorkspaceProps {
  orgId?: string | null
}

type RequestForm = {
  channelWorkspaceId: string
  title: string
  objective: string
  sourceUrl: string
}

type YouTubeStudioCapabilities = {
  canCreate: boolean
  canReviewApprovals: boolean
  canViewSourceAssets: boolean
  canUseProductionJobs: boolean
}

const defaultCapabilities: YouTubeStudioCapabilities = {
  canCreate: true,
  canReviewApprovals: true,
  canViewSourceAssets: true,
  canUseProductionJobs: true,
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
  const [resolvedOrgId, setResolvedOrgId] = useState(orgId ?? '')
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
  const [capabilities, setCapabilities] = useState<YouTubeStudioCapabilities>(defaultCapabilities)
  const [retryAccountId, setRetryAccountId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const submittingRequestRef = useRef(false)
  const reviewingIdRef = useRef<string | null>(null)
  const reviewingPacketIdRef = useRef<string | null>(null)
  const reviewingDraftIdRef = useRef<string | null>(null)
  const reviewingRenderIdRef = useRef<string | null>(null)
  const loadRequestIdRef = useRef(0)
  const requestFormRef = useRef<HTMLFormElement>(null)
  const editProjectsRef = useRef<HTMLDivElement>(null)
  const workQueueRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setResolvedOrgId(orgId ?? '')
  }, [orgId])

  const activeOrgId = resolvedOrgId || orgId || undefined
  const apiPath = useMemo(() => scopedApiPath('/api/v1/portal/youtube-studio', { orgId: activeOrgId }), [activeOrgId])
  const youtubeOAuthHref = useMemo(() => {
    const redirectUrl = appendQueryParams('/portal/youtube-studio', { orgId: activeOrgId })
    return appendQueryParams('/api/v1/social/oauth/youtube', { redirectUrl, orgId: activeOrgId, feature: 'youtube_studio' })
  }, [activeOrgId])
  const linkAnotherChannelHref = useMemo(
    () => appendQueryParams(youtubeOAuthHref, { prompt: 'select_account' }),
    [youtubeOAuthHref],
  )
  const activeApiPathRef = useRef(apiPath)
  const previousApiPathRef = useRef(apiPath)
  activeApiPathRef.current = apiPath
  const notice = loadNotice || actionNotice
  const pendingVideoReviews = useMemo(() => videos.filter(isClientReviewOpen), [videos])
  const pendingPacketReviews = useMemo(
    () => packets.filter((packet) => packet.status === 'client_review'),
    [packets],
  )
  const pendingDraftReviews = useMemo(
    () => productionDrafts.filter((draft) => draft.status === 'client_review'),
    [productionDrafts],
  )
  const pendingRenderReviews = useMemo(
    () => renderJobs.filter((job) => job.status === 'qa_review'),
    [renderJobs],
  )
  const pendingWorkCount =
    pendingVideoReviews.length + pendingPacketReviews.length + pendingDraftReviews.length + pendingRenderReviews.length
  const requestCanSubmit = Boolean(
    capabilities.canCreate && request.channelWorkspaceId && request.title.trim() && request.objective.trim(),
  )
  const requestHelpText = buildRequestHelpText(request, submittingRequest)
  const workQueue = useMemo(
    () => filterWorkQueueByChannel(
      buildWorkQueue({ videos, packets, productionDrafts, renderJobs }),
      selectedChannelId,
    ),
    [videos, packets, productionDrafts, renderJobs, selectedChannelId],
  )

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
      if (typeof body.data?.orgId === 'string' && body.data.orgId.trim()) {
        setResolvedOrgId(body.data.orgId.trim())
      }
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
      setCapabilities({
        canCreate: body.data?.capabilities?.canCreate !== false,
        canReviewApprovals: body.data?.capabilities?.canReviewApprovals !== false,
        canViewSourceAssets: body.data?.capabilities?.canViewSourceAssets !== false,
        canUseProductionJobs: body.data?.capabilities?.canUseProductionJobs !== false,
      })
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

  function scrollToSection(target: 'request' | 'editor' | 'queue') {
    const element = target === 'request' ? requestFormRef.current : target === 'editor' ? editProjectsRef.current : workQueueRef.current
    const run = () => element?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run)
    else run()
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault()
    if (!capabilities.canCreate) {
      setActionNotice('YouTube video requests are disabled for your organisation role.')
      return
    }
    if (submittingRequestRef.current || !requestCanSubmit) {
      setActionNotice(requestHelpText)
      return
    }
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
      setActionNotice('Video request sent to the PiB team. Next: PiB will shape the brief and move it into the pipeline when work starts.')
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
    if (!capabilities.canReviewApprovals) {
      setActionNotice('YouTube review decisions are disabled for your organisation role.')
      return
    }
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
    if (!capabilities.canReviewApprovals) {
      setActionNotice('YouTube publishing approvals are disabled for your organisation role.')
      return
    }
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
    if (!capabilities.canReviewApprovals) {
      setActionNotice('YouTube production approvals are disabled for your organisation role.')
      return
    }
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
    if (!capabilities.canReviewApprovals) {
      setActionNotice('YouTube render approvals are disabled for your organisation role.')
      return
    }
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

  async function repurposeVideo(videoId: string) {
    setActionNotice('')
    try {
      const res = await fetch(
        scopedApiPath(`/api/v1/youtube-studio/videos/${videoId}/repurpose`, { orgId: activeOrgId }),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platforms: ['linkedin', 'twitter', 'facebook'] }),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not create social drafts')
        return
      }
      setActionNotice('Draft social posts created — review them in Social.')
    } catch {
      setActionNotice('Could not create social drafts')
    }
  }

  function renderWorkQueueActions(item: WorkQueueItem) {
    if (item.kind === 'video' && item.video && capabilities.canReviewApprovals && isClientReviewOpen(item.video)) {
      return (
        <div className="w-full space-y-3">
          <textarea
            rows={3}
            disabled={reviewingId === item.id}
            value={reviewNotes[item.id] ?? ''}
            onChange={(event) => setReviewNotes((prev) => ({ ...prev, [item.id]: event.target.value }))}
            placeholder="Notes for PiB"
            aria-label="Notes for PiB"
            className="w-full rounded-[6px] border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(reviewingId)} onClick={() => saveDecision(item.id, 'approved')} className="pib-btn-primary text-sm">Approve</button>
            <button type="button" disabled={Boolean(reviewingId)} onClick={() => saveDecision(item.id, 'changes_requested')} className="pib-btn-ghost text-sm">Request changes</button>
            <button type="button" disabled={Boolean(reviewingId)} onClick={() => saveDecision(item.id, 'rejected')} className="pib-btn-ghost text-sm">Reject</button>
          </div>
        </div>
      )
    }
    if (item.kind === 'video' && item.video?.status === 'live') {
      return <button type="button" onClick={() => void repurposeVideo(item.id)} className="pib-btn-ghost text-sm">Repurpose to social</button>
    }
    if (item.kind === 'packet' && item.packet?.status === 'client_review') {
      return <a href="#youtube-studio-details" className="pib-btn-primary text-sm">Review packet below</a>
    }
    if (item.kind === 'production_draft') {
      return <a href="#youtube-studio-details" className="pib-btn-primary text-sm">Review draft below</a>
    }
    if (item.kind === 'render_job' && item.renderJob?.status === 'qa_review') {
      return <a href="#youtube-studio-details" className="pib-btn-primary text-sm">Review render below</a>
    }
    return null
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
        <Suspense fallback={null}>
          <YouTubeStudioOAuthReturnHandler onRefresh={load} onProvisionFailed={setRetryAccountId} />
        </Suspense>
        <div className="rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-text)]">
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
      description="Create or request videos, track the work PiB is producing, and approve what goes live on your channel."
      notice={notice}
      loading={loading}
      className="p-4 sm:p-6 lg:p-8"
    >
      <Suspense fallback={null}>
        <YouTubeStudioOAuthReturnHandler onRefresh={load} onProvisionFailed={setRetryAccountId} />
      </Suspense>
      <YouTubeStudioChannelHeader
        channels={channels}
        selectedChannelId={selectedChannelId}
        onSelect={setSelectedChannelId}
        oauthHref={youtubeOAuthHref}
        linkAnotherChannelHref={linkAnotherChannelHref}
      />

      {channels.length === 0 && !loading ? <YouTubeStudioGuide oauthHref={youtubeOAuthHref} /> : null}

      <section className="grid gap-3 md:grid-cols-3">
        <article className="pib-card-section flex min-w-0 flex-col gap-4 p-5">
          <div className="min-w-0">
            <p className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Create</p>
            <h2 className="mt-1 font-headline text-xl text-[var(--color-pib-text)]">Create video edit</h2>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Start a channel-linked edit project in the Video Editor or open recent edits.</p>
          </div>
          <button type="button" onClick={() => scrollToSection('editor')} className="pib-btn-primary mt-auto justify-center text-sm">
            Create video edit
          </button>
        </article>
        <article className="pib-card-section flex min-w-0 flex-col gap-4 p-5">
          <div className="min-w-0">
            <p className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Request</p>
            <h2 className="mt-1 font-headline text-xl text-[var(--color-pib-text)]">Request a PiB video</h2>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{channels.length ? 'Send PiB a clear brief for the next video.' : 'Link a channel before requesting production work.'}</p>
          </div>
          <button type="button" onClick={() => scrollToSection('request')} className="pib-btn-ghost mt-auto justify-center text-sm">
            Request a PiB video
          </button>
        </article>
        <article className="pib-card-section flex min-w-0 flex-col gap-4 p-5">
          <div className="min-w-0">
            <p className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Review</p>
            <h2 className="mt-1 font-headline text-xl text-[var(--color-pib-text)]">Review pending work</h2>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
              {pendingWorkCount ? `${pendingWorkCount} item${pendingWorkCount === 1 ? '' : 's'} waiting for a decision.` : 'No client decisions waiting right now.'}
            </p>
          </div>
          <button type="button" onClick={() => scrollToSection('queue')} className="pib-btn-ghost mt-auto justify-center text-sm">
            Review pending work
          </button>
        </article>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-6">
          <div ref={workQueueRef}>
            <YouTubeStudioWorkQueue groups={workQueue} renderItemActions={renderWorkQueueActions} />
          </div>

          <div id="youtube-studio-details">
            <YouTubeStudioDetailsTabs
              sourceAssets={sourceAssets}
              clipCandidates={clipCandidates}
              productionDrafts={productionDrafts}
              renderJobs={renderJobs}
              packets={packets}
              releasePlans={releasePlans}
              analytics={analytics}
              canReviewApprovals={capabilities.canReviewApprovals}
              draftNotes={draftNotes}
              renderNotes={renderNotes}
              packetNotes={packetNotes}
              reviewingDraftId={reviewingDraftId}
              reviewingRenderId={reviewingRenderId}
              reviewingPacketId={reviewingPacketId}
              onDraftNotesChange={(id, value) => setDraftNotes((prev) => ({ ...prev, [id]: value }))}
              onRenderNotesChange={(id, value) => setRenderNotes((prev) => ({ ...prev, [id]: value }))}
              onPacketNotesChange={(id, value) => setPacketNotes((prev) => ({ ...prev, [id]: value }))}
              onDraftDecision={(id, decision) => void saveDraftDecision(id, decision)}
              onRenderDecision={(id, decision) => void saveRenderDecision(id, decision)}
              onPacketDecision={(id, decision) => void savePacketDecision(id, decision)}
            />
          </div>

          <div ref={editProjectsRef}>
            <VideoEditorProjectList orgId={activeOrgId} channelOptions={channels} compact />
          </div>
        </section>

        <aside className="h-fit space-y-4 lg:sticky lg:top-6">
          <div className="pib-card-section space-y-3 p-5">
            <h2 className="font-headline text-[var(--color-pib-text)]">Link your channel</h2>
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              Connects through the existing social-account OAuth flow and returns here after YouTube authorises the channel.
            </p>
            <a href={youtubeOAuthHref} className="pib-btn-primary w-full justify-center text-center">
              Link YouTube channel
            </a>
            {retryAccountId ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch(scopedApiPath('/api/v1/youtube-studio/channels/adopt', { orgId: activeOrgId }), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ accountId: retryAccountId }),
                    })
                    const body = await res.json().catch(() => ({}))
                    if (!res.ok) {
                      setActionNotice(body.error ?? 'Could not finish channel setup')
                      return
                    }
                    setRetryAccountId(null)
                    setActionNotice('Channel setup completed.')
                    await load()
                  } catch {
                    setActionNotice('Could not finish channel setup')
                  }
                }}
                className="pib-btn-ghost w-full justify-center text-center text-sm"
              >
                Retry channel setup
              </button>
            ) : null}
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              This connection is shared with Marketing Studio&apos;s social posting.
            </p>
          </div>

          {capabilities.canCreate ? (
          <form ref={requestFormRef} onSubmit={submitRequest} className="pib-card-section space-y-4 p-5">
            <div>
              <h2 className="font-headline text-[var(--color-pib-text)]">Request a PiB video</h2>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">Channel, title, and objective are required before PiB can scope the work.</p>
            </div>
            <ChannelChoices
              channels={channels}
              selectedId={request.channelWorkspaceId}
              onChange={(value) => update('channelWorkspaceId', value)}
            />
            <Field label="Video title" value={request.title} onChange={(value) => update('title', value)} required />
            <LabeledTextArea label="Objective" value={request.objective} onChange={(value) => update('objective', value)} required />
            <Field label="Source URL" value={request.sourceUrl} onChange={(value) => update('sourceUrl', value)} />
            <p className="text-xs text-[var(--color-pib-text-muted)]" aria-live="polite">{requestHelpText}</p>
            <button type="submit" disabled={submittingRequest || !requestCanSubmit} className="pib-btn-primary w-full">
              {submittingRequest ? 'Sending...' : 'Send request'}
            </button>
          </form>
          ) : (
            <div className="pib-card-section p-5 text-sm text-[var(--color-pib-text-muted)]">
              YouTube video requests are disabled for your organisation role.
            </div>
          )}
        </aside>
      </div>
    </YouTubeStudioWorkspaceShell>
  )
}

function buildRequestHelpText(request: RequestForm, submitting: boolean) {
  if (submitting) return 'Sending your request to PiB.'
  const missing = [
    !request.channelWorkspaceId ? 'choose a channel' : null,
    !request.title.trim() ? 'add a video title' : null,
    !request.objective.trim() ? 'describe the objective' : null,
  ].filter(Boolean)
  if (missing.length === 0) return 'Ready to send to PiB.'
  return `To send this request, ${joinHumanList(missing)}.`
}

function joinHumanList(items: unknown[]) {
  const values = items.map(String)
  if (values.length <= 1) return values[0] ?? ''
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`
}

function channelChoiceLabel(channel: YouTubeChannelWorkspace) {
  return channel.title || channel.youtubeHandle || 'YouTube channel'
}

function channelChoiceMeta(channel: YouTubeChannelWorkspace) {
  return channel.youtubeHandle || channel.youtubeChannelId || 'Channel connection pending'
}

function ChannelChoices({
  channels,
  selectedId,
  onChange,
}: {
  channels: YouTubeChannelWorkspace[]
  selectedId: string
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Channel</legend>
      {channels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-pib-line)] p-3 text-sm text-[var(--color-pib-text-muted)]">
          Link a YouTube channel before sending a request.
        </div>
      ) : (
        <div className="grid gap-2">
          {channels.map((channel) => {
            const id = channel.id ?? ''
            const checked = selectedId === id
            return (
              <label
                key={id || channel.title}
                className={[
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition',
                  checked
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-pib-text)]'
                    : 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text-muted)] hover:border-[var(--color-primary)]',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="youtube-request-channel"
                  value={id}
                  checked={checked}
                  disabled={!id}
                  onChange={(event) => onChange(event.target.value)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block break-words font-medium text-[var(--color-pib-text)]">{channelChoiceLabel(channel)}</span>
                  <span className="block break-words text-xs text-[var(--color-pib-text-muted)]">{channelChoiceMeta(channel)}</span>
                </span>
              </label>
            )
          })}
        </div>
      )}
    </fieldset>
  )
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
      <span className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</span>
      <input
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
      />
    </label>
  )
}

function LabeledTextArea({
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
      <span className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</span>
      <textarea
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm"
      />
    </label>
  )
}
