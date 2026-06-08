'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  YouTubeAgentJob,
  YouTubeAnalyticsFreshness,
  YouTubeAnalyticsRecommendationConfidence,
  YouTubeAnalyticsRecommendationType,
  YouTubeAnalyticsSnapshot,
  YouTubeAnalyticsSource,
  YouTubeApiProjectStatus,
  YouTubeChannelWorkspace,
  YouTubeClipCandidate,
  YouTubeClipTargetFormat,
  YouTubeConnectedAccountStatus,
  YouTubePublishingPacket,
  YouTubePublishingPolicy,
  YouTubePublishingReadinessLevel,
  YouTubeProductionSkillKey,
  YouTubeReleaseMode,
  YouTubeReleasePlan,
  YouTubeSeries,
  YouTubeSourceAsset,
  YouTubeSourceAssetType,
  YouTubeVideoProject,
  YouTubeVideoType,
} from '@/lib/youtube-studio/types'
import { YOUTUBE_PRODUCTION_SKILLS } from '@/lib/youtube-studio/skills'
import { StatusPill, YouTubeChannelCard, YouTubeVideoCard } from '@/components/youtube-studio/YouTubeStudioCards'
import { YouTubeStudioWorkspaceShell } from '@/components/youtube-studio/YouTubeStudioWorkspaceShell'

interface YouTubeStudioAdminWorkspaceProps {
  orgId: string
  orgName: string
}

type FormState = {
  channelTitle: string
  youtubeHandle: string
  contentPillars: string
  audienceNotes: string
  videoChannelId: string
  videoTitle: string
  objective: string
  videoType: YouTubeVideoType
  sourceUrl: string
  assetChannelId: string
  assetVideoId: string
  assetTitle: string
  assetType: YouTubeSourceAssetType
  assetUrl: string
  assetDurationSeconds: string
  assetClientNotes: string
  assetShowInPortal: boolean
  clipSourceAssetId: string
  clipVideoId: string
  clipTitle: string
  clipStart: string
  clipEnd: string
  clipTargetFormat: YouTubeClipTargetFormat
  clipSummary: string
  clipHook: string
  clipTranscriptExcerpt: string
  clipShowInPortal: boolean
  jobVideoId: string
  jobSkillKey: YouTubeProductionSkillKey
  jobInputSummary: string
  packetVideoId: string
  packetTitle: string
  packetDescription: string
  packetTags: string
  packetChapters: string
  packetMadeForKids: boolean
  packetContainsSyntheticMedia: boolean
  packetAiDisclosureNotes: string
  releasePacketId: string
  releaseMode: YouTubeReleaseMode
  releaseTargetVisibility: YouTubePublishingPolicy['defaultVisibility']
  releaseScheduledPublishAt: string
  releasePublicSummary: string
  releaseInternalNotes: string
  analyticsChannelId: string
  analyticsVideoId: string
  analyticsPeriodStart: string
  analyticsPeriodEnd: string
  analyticsSource: YouTubeAnalyticsSource
  analyticsFreshness: YouTubeAnalyticsFreshness
  analyticsViews: string
  analyticsWatchTimeMinutes: string
  analyticsAverageViewPercentage: string
  analyticsImpressionsCtr: string
  analyticsClientSummary: string
  analyticsRecommendationType: YouTubeAnalyticsRecommendationType
  analyticsRecommendationSummary: string
  analyticsRecommendationConfidence: YouTubeAnalyticsRecommendationConfidence
  analyticsShowInPortal: boolean
  readinessChannelId: string
  readinessConnectedAccountId: string
  readinessAccountStatus: YouTubeConnectedAccountStatus
  readinessApiProjectStatus: YouTubeApiProjectStatus
  readinessLevel: YouTubePublishingReadinessLevel
  readinessDefaultPrivacy: YouTubePublishingPolicy['defaultVisibility']
  readinessQuotaDailyLimit: string
  readinessQuotaUnitsRemaining: string
  readinessNotes: string
}

const emptyForm: FormState = {
  channelTitle: '',
  youtubeHandle: '',
  contentPillars: '',
  audienceNotes: '',
  videoChannelId: '',
  videoTitle: '',
  objective: '',
  videoType: 'long_form',
  sourceUrl: '',
  assetChannelId: '',
  assetVideoId: '',
  assetTitle: '',
  assetType: 'raw_footage',
  assetUrl: '',
  assetDurationSeconds: '',
  assetClientNotes: '',
  assetShowInPortal: false,
  clipSourceAssetId: '',
  clipVideoId: '',
  clipTitle: '',
  clipStart: '',
  clipEnd: '',
  clipTargetFormat: 'vertical_short',
  clipSummary: '',
  clipHook: '',
  clipTranscriptExcerpt: '',
  clipShowInPortal: false,
  jobVideoId: '',
  jobSkillKey: 'youtube-video-brief',
  jobInputSummary: '',
  packetVideoId: '',
  packetTitle: '',
  packetDescription: '',
  packetTags: '',
  packetChapters: '',
  packetMadeForKids: false,
  packetContainsSyntheticMedia: false,
  packetAiDisclosureNotes: '',
  releasePacketId: '',
  releaseMode: 'manual_handoff',
  releaseTargetVisibility: 'private',
  releaseScheduledPublishAt: '',
  releasePublicSummary: '',
  releaseInternalNotes: '',
  analyticsChannelId: '',
  analyticsVideoId: '',
  analyticsPeriodStart: '',
  analyticsPeriodEnd: '',
  analyticsSource: 'manual_import',
  analyticsFreshness: 'partial',
  analyticsViews: '',
  analyticsWatchTimeMinutes: '',
  analyticsAverageViewPercentage: '',
  analyticsImpressionsCtr: '',
  analyticsClientSummary: '',
  analyticsRecommendationType: 'follow_up_video',
  analyticsRecommendationSummary: '',
  analyticsRecommendationConfidence: 'low',
  analyticsShowInPortal: false,
  readinessChannelId: '',
  readinessConnectedAccountId: '',
  readinessAccountStatus: 'not_connected',
  readinessApiProjectStatus: 'unknown',
  readinessLevel: 'not_ready',
  readinessDefaultPrivacy: 'private',
  readinessQuotaDailyLimit: '',
  readinessQuotaUnitsRemaining: '',
  readinessNotes: '',
}

const videoTypes: YouTubeVideoType[] = [
  'short',
  'long_form',
  'clip_pack',
  'podcast_episode',
  'webinar_cutdown',
  'testimonial',
  'case_study',
  'tutorial',
  'product_demo',
  'ad_creative',
  'community_update',
]
const analyticsSources: YouTubeAnalyticsSource[] = ['manual_import', 'youtube_analytics_api', 'youtube_reporting_api']
const analyticsFreshnessOptions: YouTubeAnalyticsFreshness[] = ['fresh', 'delayed', 'partial', 'estimated']
const analyticsRecommendationTypes: YouTubeAnalyticsRecommendationType[] = [
  'retitle',
  'thumbnail_test',
  'shorts_pack',
  'follow_up_video',
  'series_change',
  'cadence_change',
]
const analyticsRecommendationConfidences: YouTubeAnalyticsRecommendationConfidence[] = ['low', 'medium', 'high']
const connectedAccountStatuses: YouTubeConnectedAccountStatus[] = ['not_connected', 'connected', 'needs_reauth', 'revoked', 'blocked']
const apiProjectStatuses: YouTubeApiProjectStatus[] = [
  'unknown',
  'unverified_private_only',
  'verified',
  'audit_required',
  'quota_limited',
  'blocked',
]
const publishingReadinessLevels: YouTubePublishingReadinessLevel[] = [
  'not_ready',
  'manual_only',
  'private_upload_ready',
  'scheduled_publish_ready',
  'blocked',
]
const releaseModes: YouTubeReleaseMode[] = ['manual_handoff', 'private_api_upload', 'scheduled_api_publish']
const publishingVisibilities: YouTubePublishingPolicy['defaultVisibility'][] = ['private', 'unlisted', 'public']
const sourceAssetTypes: YouTubeSourceAssetType[] = [
  'raw_footage',
  'source_url',
  'transcript',
  'thumbnail',
  'audio',
  'caption',
  'broll',
  'image',
  'document',
  'rendered_video',
]
const clipTargetFormats: YouTubeClipTargetFormat[] = [
  'vertical_short',
  'square_short',
  'long_form_excerpt',
  'ad_cutdown',
  'testimonial_cut',
]

function splitLines(value: string) {
  return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
}

function numericValue(value: string) {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function timestampToSeconds(value: string): number | undefined {
  const parts = value.split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return undefined
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return undefined
}

function parseChapters(value: string): YouTubePublishingPacket['chapters'] {
  return value.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+(?::\d{1,2}){0,2})\s+(.+)$/)
    if (!match) return []
    const startSeconds = timestampToSeconds(match[1])
    const title = match[2].trim()
    return startSeconds === undefined || !title ? [] : [{ startSeconds, title }]
  })
}

export function YouTubeStudioAdminWorkspace({ orgId, orgName }: YouTubeStudioAdminWorkspaceProps) {
  const [channels, setChannels] = useState<YouTubeChannelWorkspace[]>([])
  const [series, setSeries] = useState<YouTubeSeries[]>([])
  const [videos, setVideos] = useState<YouTubeVideoProject[]>([])
  const [packets, setPackets] = useState<YouTubePublishingPacket[]>([])
  const [releasePlans, setReleasePlans] = useState<YouTubeReleasePlan[]>([])
  const [sourceAssets, setSourceAssets] = useState<YouTubeSourceAsset[]>([])
  const [clipCandidates, setClipCandidates] = useState<YouTubeClipCandidate[]>([])
  const [jobs, setJobs] = useState<YouTubeAgentJob[]>([])
  const [analytics, setAnalytics] = useState<YouTubeAnalyticsSnapshot[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addingSourceAsset, setAddingSourceAsset] = useState(false)
  const [creatingClipCandidate, setCreatingClipCandidate] = useState(false)
  const [creatingPacket, setCreatingPacket] = useState(false)
  const [creatingReleasePlan, setCreatingReleasePlan] = useState(false)
  const [updatingPacketId, setUpdatingPacketId] = useState<string | null>(null)
  const [queueingJob, setQueueingJob] = useState(false)
  const [importingAnalytics, setImportingAnalytics] = useState(false)
  const [savingReadiness, setSavingReadiness] = useState(false)
  const [loadNotice, setLoadNotice] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const loadRequestIdRef = useRef(0)
  const activeOrgIdRef = useRef(orgId)
  const previousOrgIdRef = useRef(orgId)
  activeOrgIdRef.current = orgId
  const notice = loadNotice || actionNotice
  const analyticsVideoOptions = form.analyticsChannelId
    ? videos.filter((video) => video.channelWorkspaceId === form.analyticsChannelId)
    : videos
  const assetVideoOptions = form.assetChannelId
    ? videos.filter((video) => video.channelWorkspaceId === form.assetChannelId)
    : videos
  const clipVideoOptions = form.clipSourceAssetId
    ? videos.filter((video) => {
        const sourceAsset = sourceAssets.find((asset) => asset.id === form.clipSourceAssetId)
        return sourceAsset ? video.channelWorkspaceId === sourceAsset.channelWorkspaceId : true
      })
    : videos
  const approvedPackets = packets.filter((packet) => packet.id && packet.status === 'approved')

  const load = useCallback(async () => {
    if (orgId !== activeOrgIdRef.current) return
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const isCurrentRequest = () => requestId === loadRequestIdRef.current && orgId === activeOrgIdRef.current
    setLoading(true)
    try {
      const [channelRes, seriesRes, videoRes, packetRes, releasePlanRes, sourceAssetRes, clipCandidateRes, jobRes, analyticsRes] = await Promise.all([
        fetch(`/api/v1/youtube-studio/channels?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/series?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/videos?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/publish-packets?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/release-plans?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/source-assets?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/clip-candidates?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/agent-jobs?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/analytics?orgId=${encodeURIComponent(orgId)}`),
      ])
      const [channelBody, seriesBody, videoBody, packetBody, releasePlanBody, sourceAssetBody, clipCandidateBody, jobBody, analyticsBody] = await Promise.all([
        channelRes.json().catch(() => ({})),
        seriesRes.json().catch(() => ({})),
        videoRes.json().catch(() => ({})),
        packetRes.json().catch(() => ({})),
        releasePlanRes.json().catch(() => ({})),
        sourceAssetRes.json().catch(() => ({})),
        clipCandidateRes.json().catch(() => ({})),
        jobRes.json().catch(() => ({})),
        analyticsRes.json().catch(() => ({})),
      ])
      if (!isCurrentRequest()) return
      setChannels(Array.isArray(channelBody.data?.channels) ? channelBody.data.channels : [])
      setSeries(Array.isArray(seriesBody.data?.series) ? seriesBody.data.series : [])
      setVideos(Array.isArray(videoBody.data?.videos) ? videoBody.data.videos : [])
      setPackets(Array.isArray(packetBody.data?.packets) ? packetBody.data.packets : [])
      setReleasePlans(Array.isArray(releasePlanBody.data?.releasePlans) ? releasePlanBody.data.releasePlans : [])
      setSourceAssets(Array.isArray(sourceAssetBody.data?.sourceAssets) ? sourceAssetBody.data.sourceAssets : [])
      setClipCandidates(Array.isArray(clipCandidateBody.data?.clipCandidates) ? clipCandidateBody.data.clipCandidates : [])
      setJobs(Array.isArray(jobBody.data?.jobs) ? jobBody.data.jobs : [])
      setAnalytics(Array.isArray(analyticsBody.data?.snapshots) ? analyticsBody.data.snapshots : [])
      if (
        !channelRes.ok ||
        !seriesRes.ok ||
        !videoRes.ok ||
        !packetRes.ok ||
        !releasePlanRes.ok ||
        !sourceAssetRes.ok ||
        !clipCandidateRes.ok ||
        !jobRes.ok ||
        !analyticsRes.ok
      ) {
        setLoadNotice('Could not load the full YouTube Studio workspace.')
      } else {
        setLoadNotice('')
      }
    } catch {
      if (!isCurrentRequest()) return
      setChannels([])
      setSeries([])
      setVideos([])
      setPackets([])
      setReleasePlans([])
      setSourceAssets([])
      setClipCandidates([])
      setJobs([])
      setAnalytics([])
      setLoadNotice('Could not load the YouTube Studio workspace.')
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
      }
    }
  }, [orgId])

  useEffect(() => {
    if (previousOrgIdRef.current === orgId) return
    previousOrgIdRef.current = orgId
    setForm(emptyForm)
    setSaving(false)
    setAddingSourceAsset(false)
    setCreatingClipCandidate(false)
    setCreatingPacket(false)
    setCreatingReleasePlan(false)
    setUpdatingPacketId(null)
    setQueueingJob(false)
    setImportingAnalytics(false)
    setSavingReadiness(false)
    setLoadNotice('')
    setActionNotice('')
  }, [orgId])

  useEffect(() => {
    if (orgId) void load()
    return () => {
      loadRequestIdRef.current += 1
    }
  }, [orgId, load])

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function selectAnalyticsChannel(channelWorkspaceId: string) {
    setForm((prev) => {
      const selectedVideo = videos.find((video) => video.id === prev.analyticsVideoId)
      const keepSelectedVideo = !channelWorkspaceId || selectedVideo?.channelWorkspaceId === channelWorkspaceId

      return {
        ...prev,
        analyticsChannelId: channelWorkspaceId,
        analyticsVideoId: keepSelectedVideo ? prev.analyticsVideoId : '',
      }
    })
  }

  function selectAnalyticsVideo(videoProjectId: string) {
    const selectedVideo = videos.find((video) => video.id === videoProjectId)
    setForm((prev) => ({
      ...prev,
      analyticsVideoId: videoProjectId,
      analyticsChannelId: selectedVideo?.channelWorkspaceId ?? prev.analyticsChannelId,
    }))
  }

  function selectAssetChannel(channelWorkspaceId: string) {
    setForm((prev) => {
      const selectedVideo = videos.find((video) => video.id === prev.assetVideoId)
      const keepSelectedVideo = !channelWorkspaceId || selectedVideo?.channelWorkspaceId === channelWorkspaceId

      return {
        ...prev,
        assetChannelId: channelWorkspaceId,
        assetVideoId: keepSelectedVideo ? prev.assetVideoId : '',
      }
    })
  }

  function selectAssetVideo(videoProjectId: string) {
    const selectedVideo = videos.find((video) => video.id === videoProjectId)
    setForm((prev) => ({
      ...prev,
      assetVideoId: videoProjectId,
      assetChannelId: selectedVideo?.channelWorkspaceId ?? prev.assetChannelId,
    }))
  }

  function selectClipSourceAsset(sourceAssetId: string) {
    const sourceAsset = sourceAssets.find((asset) => asset.id === sourceAssetId)
    setForm((prev) => ({
      ...prev,
      clipSourceAssetId: sourceAssetId,
      clipVideoId: sourceAsset?.videoProjectId ?? prev.clipVideoId,
    }))
  }

  function allowedModesForReadiness(readiness: YouTubePublishingReadinessLevel): YouTubePublishingPolicy['allowedModes'] {
    if (readiness === 'scheduled_publish_ready') {
      return ['manual_handoff', 'private_api_upload', 'scheduled_api_publish']
    }
    if (readiness === 'private_upload_ready') return ['manual_handoff', 'private_api_upload']
    return ['manual_handoff']
  }

  async function saveChannel(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !form.channelTitle.trim()) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setSaving(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          title: form.channelTitle,
          youtubeHandle: form.youtubeHandle,
          contentPillars: splitLines(form.contentPillars),
          audienceNotes: form.audienceNotes,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not save YouTube channel workspace')
        return
      }
      setForm((prev) => ({
        ...prev,
        channelTitle: '',
        youtubeHandle: '',
        contentPillars: '',
        audienceNotes: '',
        videoChannelId: body.data?.id ?? prev.videoChannelId,
        analyticsChannelId: body.data?.id ?? prev.analyticsChannelId,
        readinessChannelId: body.data?.id ?? prev.readinessChannelId,
      }))
      setActionNotice('YouTube channel workspace saved.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not save YouTube channel workspace')
      }
    } finally {
      if (isCurrentMutation()) {
        setSaving(false)
      }
    }
  }

  async function saveVideo(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !form.videoChannelId || !form.videoTitle.trim()) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setSaving(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          channelWorkspaceId: form.videoChannelId,
          title: form.videoTitle,
          objective: form.objective,
          videoType: form.videoType,
          source: { intakeType: form.sourceUrl ? 'source_url' : 'manual', sourceUrl: form.sourceUrl },
          visibility: { showInClientPortal: true },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not save video project')
        return
      }
      setForm((prev) => ({
        ...prev,
        videoTitle: '',
        objective: '',
        sourceUrl: '',
        jobVideoId: body.data?.id ?? prev.jobVideoId,
        packetVideoId: body.data?.id ?? prev.packetVideoId,
        assetVideoId: body.data?.id ?? prev.assetVideoId,
        assetChannelId: prev.assetChannelId || prev.videoChannelId,
        analyticsVideoId: body.data?.id ?? prev.analyticsVideoId,
        analyticsChannelId: prev.analyticsChannelId || prev.videoChannelId,
      }))
      setActionNotice('Video project saved.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not save video project')
      }
    } finally {
      if (isCurrentMutation()) {
        setSaving(false)
      }
    }
  }

  async function createSourceAsset(event: React.FormEvent) {
    event.preventDefault()
    if (addingSourceAsset || !form.assetChannelId || !form.assetTitle.trim()) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setAddingSourceAsset(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/source-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          channelWorkspaceId: form.assetChannelId,
          videoProjectId: form.assetVideoId || undefined,
          title: form.assetTitle,
          assetType: form.assetType,
          sourceUrl: form.assetUrl,
          durationSeconds: numericValue(form.assetDurationSeconds),
          clientNotes: form.assetClientNotes,
          visibility: { showInClientPortal: form.assetShowInPortal },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not add source asset')
        return
      }
      setForm((prev) => ({
        ...prev,
        assetTitle: '',
        assetUrl: '',
        assetDurationSeconds: '',
        assetClientNotes: '',
        assetShowInPortal: false,
        clipSourceAssetId: body.data?.id ?? prev.clipSourceAssetId,
      }))
      setActionNotice('Source asset added.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not add source asset')
      }
    } finally {
      if (isCurrentMutation()) {
        setAddingSourceAsset(false)
      }
    }
  }

  async function createClipCandidate(event: React.FormEvent) {
    event.preventDefault()
    if (creatingClipCandidate || !form.clipSourceAssetId || !form.clipTitle.trim()) return
    const startSeconds = timestampToSeconds(form.clipStart)
    const endSeconds = timestampToSeconds(form.clipEnd)
    if (startSeconds === undefined || endSeconds === undefined) {
      setActionNotice('Clip start and end must be valid timestamps.')
      return
    }

    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setCreatingClipCandidate(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/clip-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          sourceAssetId: form.clipSourceAssetId,
          videoProjectId: form.clipVideoId || undefined,
          title: form.clipTitle,
          startSeconds,
          endSeconds,
          targetFormat: form.clipTargetFormat,
          summary: form.clipSummary,
          hook: form.clipHook,
          transcriptExcerpt: form.clipTranscriptExcerpt,
          visibility: { showInClientPortal: form.clipShowInPortal },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not create clip candidate')
        return
      }
      setForm((prev) => ({
        ...prev,
        clipTitle: '',
        clipStart: '',
        clipEnd: '',
        clipSummary: '',
        clipHook: '',
        clipTranscriptExcerpt: '',
        clipShowInPortal: false,
      }))
      setActionNotice('Clip candidate created.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not create clip candidate')
      }
    } finally {
      if (isCurrentMutation()) {
        setCreatingClipCandidate(false)
      }
    }
  }

  async function savePublishingReadiness(event: React.FormEvent) {
    event.preventDefault()
    if (savingReadiness || !form.readinessChannelId) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setSavingReadiness(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch(`/api/v1/youtube-studio/channels/${encodeURIComponent(form.readinessChannelId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectedAccountId: form.readinessConnectedAccountId,
          publishingReadiness: {
            accountStatus: form.readinessAccountStatus,
            apiProjectStatus: form.readinessApiProjectStatus,
            readiness: form.readinessLevel,
            defaultUploadPrivacy: form.readinessDefaultPrivacy,
            allowedModes: allowedModesForReadiness(form.readinessLevel),
            quotaDailyLimit: numericValue(form.readinessQuotaDailyLimit),
            quotaUnitsRemaining: numericValue(form.readinessQuotaUnitsRemaining),
            notes: form.readinessNotes,
          },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not save publishing readiness')
        return
      }
      setActionNotice('Publishing readiness saved.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not save publishing readiness')
      }
    } finally {
      if (isCurrentMutation()) {
        setSavingReadiness(false)
      }
    }
  }

  async function createPublishingPacket(event: React.FormEvent) {
    event.preventDefault()
    if (creatingPacket || !form.packetVideoId) return
    const selectedVideo = videos.find((video) => video.id === form.packetVideoId)
    if (!selectedVideo?.channelWorkspaceId) {
      setActionNotice('Select a video with a channel before creating a publishing packet')
      return
    }

    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setCreatingPacket(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const title = form.packetTitle.trim() || selectedVideo.title
      const res = await fetch('/api/v1/youtube-studio/publish-packets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          channelWorkspaceId: selectedVideo.channelWorkspaceId,
          videoProjectId: form.packetVideoId,
          titleOptions: title ? [{ text: title, selected: true }] : [],
          description: form.packetDescription,
          tags: splitLines(form.packetTags),
          chapters: parseChapters(form.packetChapters),
          selfDeclaredMadeForKids: form.packetMadeForKids,
          containsSyntheticMedia: form.packetContainsSyntheticMedia,
          aiDisclosureNotes: form.packetAiDisclosureNotes,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not create publishing packet')
        return
      }
      setForm((prev) => ({
        ...prev,
        packetTitle: '',
        packetDescription: '',
        packetTags: '',
        packetChapters: '',
        packetMadeForKids: false,
        packetContainsSyntheticMedia: false,
        packetAiDisclosureNotes: '',
      }))
      setActionNotice('Private draft publishing packet created.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not create publishing packet')
      }
    } finally {
      if (isCurrentMutation()) {
        setCreatingPacket(false)
      }
    }
  }

  async function updatePublishingPacketStatus(packetId: string | undefined, status: Exclude<YouTubePublishingPacket['status'], 'published'>) {
    if (updatingPacketId || !packetId) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setUpdatingPacketId(packetId)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/publish-packets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: packetId, status }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not update publishing packet')
        return
      }
      setActionNotice(packetStatusNotice(status))
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not update publishing packet')
      }
    } finally {
      if (isCurrentMutation()) {
        setUpdatingPacketId(null)
      }
    }
  }

  async function createReleasePlan(event: React.FormEvent) {
    event.preventDefault()
    if (creatingReleasePlan || !form.releasePacketId) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setCreatingReleasePlan(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/release-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          publishingPacketId: form.releasePacketId,
          mode: form.releaseMode,
          targetVisibility: form.releaseTargetVisibility,
          scheduledPublishAt: form.releaseScheduledPublishAt,
          publicSummary: form.releasePublicSummary,
          internalNotes: form.releaseInternalNotes,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not create release plan')
        return
      }
      setForm((prev) => ({
        ...prev,
        releaseScheduledPublishAt: '',
        releasePublicSummary: '',
        releaseInternalNotes: '',
      }))
      setActionNotice('Release plan created.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not create release plan')
      }
    } finally {
      if (isCurrentMutation()) {
        setCreatingReleasePlan(false)
      }
    }
  }

  async function importAnalytics(event: React.FormEvent) {
    event.preventDefault()
    if (importingAnalytics || !form.analyticsChannelId || !form.analyticsPeriodStart || !form.analyticsPeriodEnd) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setImportingAnalytics(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const recommendationSummary = form.analyticsRecommendationSummary.trim()
      const res = await fetch('/api/v1/youtube-studio/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          channelWorkspaceId: form.analyticsChannelId,
          videoProjectId: form.analyticsVideoId || undefined,
          periodStart: form.analyticsPeriodStart,
          periodEnd: form.analyticsPeriodEnd,
          source: form.analyticsSource,
          sourceFreshness: form.analyticsFreshness,
          metrics: {
            views: numericValue(form.analyticsViews),
            watchTimeMinutes: numericValue(form.analyticsWatchTimeMinutes),
            averageViewPercentage: numericValue(form.analyticsAverageViewPercentage),
            impressionsCtr: numericValue(form.analyticsImpressionsCtr),
          },
          clientSummary: form.analyticsClientSummary,
          recommendations: recommendationSummary
            ? [{
                type: form.analyticsRecommendationType,
                summary: recommendationSummary,
                confidence: form.analyticsRecommendationConfidence,
              }]
            : [],
          visibility: { showInClientPortal: form.analyticsShowInPortal },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not import analytics snapshot')
        return
      }
      setForm((prev) => ({
        ...prev,
        analyticsViews: '',
        analyticsWatchTimeMinutes: '',
        analyticsAverageViewPercentage: '',
        analyticsImpressionsCtr: '',
        analyticsClientSummary: '',
        analyticsRecommendationSummary: '',
      }))
      setActionNotice('Analytics snapshot imported.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not import analytics snapshot')
      }
    } finally {
      if (isCurrentMutation()) {
        setImportingAnalytics(false)
      }
    }
  }

  async function queueAgentJob(event: React.FormEvent) {
    event.preventDefault()
    if (queueingJob || !form.jobVideoId) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setQueueingJob(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/agent-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          videoProjectId: form.jobVideoId,
          skillKey: form.jobSkillKey,
          inputSummary: form.jobInputSummary,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not queue Hermes job')
        return
      }
      setForm((prev) => ({ ...prev, jobInputSummary: '' }))
      setActionNotice('Hermes job packet queued.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not queue Hermes job')
      }
    } finally {
      if (isCurrentMutation()) {
        setQueueingJob(false)
      }
    }
  }

  return (
    <YouTubeStudioWorkspaceShell
      channels={channels}
      videos={videos}
      series={series}
      surface="admin"
      eyebrow={`${orgName} / Video production`}
      description="Manage channel setup, series, video requests, production state, client review, and publishing packet readiness."
      notice={notice}
      loading={loading}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-4">
          {channels.length === 0 ? (
            <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube channel workspaces yet.</div>
          ) : (
            channels.map((channel) => (
              <YouTubeChannelCard key={channel.id ?? channel.title} channel={channel} />
            ))
          )}

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Video pipeline</h2>
            {videos.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube videos yet.</div>
            ) : (
              videos.map((video) => (
                <YouTubeVideoCard key={video.id ?? video.title} video={video} />
              ))
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-headline text-xl font-semibold text-on-surface">Source assets</h2>
              <span className="rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                {sourceAssets.length} asset{sourceAssets.length === 1 ? '' : 's'}
              </span>
            </div>
            {sourceAssets.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No raw footage, transcripts, or source links captured yet.</div>
            ) : (
              <div className="grid gap-3">
                {sourceAssets.map((asset) => (
                  <article key={asset.id ?? asset.title} className="pib-card-section space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-on-surface">{asset.title}</h3>
                        <p className="mt-1 text-sm text-on-surface-variant">{sourceAssetMeta(asset)}</p>
                      </div>
                      <StatusPill status={asset.status} />
                    </div>
                    {asset.clientNotes ? <p className="break-words text-sm text-on-surface-variant">{asset.clientNotes}</p> : null}
                    {asset.sourceUrl ? <p className="break-words text-xs text-on-surface-variant">{asset.sourceUrl}</p> : null}
                    {asset.rights?.status ? (
                      <p className="break-words text-xs text-on-surface-variant">rights: {formatToken(asset.rights.status)}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-headline text-xl font-semibold text-on-surface">Clip candidates</h2>
              <span className="rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                {clipCandidates.length} clip{clipCandidates.length === 1 ? '' : 's'}
              </span>
            </div>
            {clipCandidates.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No clip candidates proposed yet.</div>
            ) : (
              <div className="grid gap-3">
                {clipCandidates.map((clip) => (
                  <article key={clip.id ?? `${clip.sourceAssetId}-${clip.startSeconds}`} className="pib-card-section space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-on-surface">{clip.title}</h3>
                        <p className="mt-1 text-sm text-on-surface-variant">{clipMeta(clip)}</p>
                      </div>
                      <StatusPill status={clip.status} />
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
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-headline text-xl font-semibold text-on-surface">Publishing packets</h2>
              <span className="rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                {packets.length} packet{packets.length === 1 ? '' : 's'}
              </span>
            </div>
            {packets.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No private draft publishing packets yet.</div>
            ) : (
              <div className="grid gap-3">
                {packets.map((packet) => (
                  <article key={packet.id ?? `${packet.videoProjectId}-${packet.versionNumber}`} className="pib-card-section space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-on-surface">{packetTitle(packet)}</h3>
                        <p className="mt-1 text-sm text-on-surface-variant">
                          Version {packet.versionNumber || 1} / {formatToken(packet.visibility)} / {packet.chapters?.length ?? 0} chapters
                        </p>
                      </div>
                      <StatusPill status={packet.status} />
                    </div>
                    {packet.description ? (
                      <p className="break-words text-sm text-on-surface-variant">{packet.description}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {packet.selfDeclaredMadeForKids ? <StatusPill status="made_for_kids" /> : null}
                      {packet.containsSyntheticMedia ? <StatusPill status="synthetic_media" /> : null}
                      {packet.tags?.slice(0, 6).map((tag) => <StatusPill key={tag} status={tag} />)}
                    </div>
                    <div className="grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
                      {packetGateEntries(packet).map(([key, check]) => (
                        <span key={key} className="min-w-0 break-words">
                          {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
                        </span>
                      ))}
                    </div>
                    {packet.id ? (
                      <div className="flex flex-wrap gap-2">
                        {packet.status !== 'client_review' && packet.status !== 'approved' && packet.status !== 'published' ? (
                          <button
                            type="button"
                            disabled={Boolean(updatingPacketId)}
                            onClick={() => updatePublishingPacketStatus(packet.id, 'client_review')}
                            className="pib-btn-primary text-sm"
                          >
                            {updatingPacketId === packet.id ? 'Updating...' : 'Send to portal'}
                          </button>
                        ) : null}
                        {packet.status !== 'approved' && packet.status !== 'published' ? (
                          <button
                            type="button"
                            disabled={Boolean(updatingPacketId)}
                            onClick={() => updatePublishingPacketStatus(packet.id, 'approved')}
                            className="pib-btn-ghost text-sm"
                          >
                            Approve packet
                          </button>
                        ) : null}
                        {packet.status !== 'blocked' && packet.status !== 'published' ? (
                          <button
                            type="button"
                            disabled={Boolean(updatingPacketId)}
                            onClick={() => updatePublishingPacketStatus(packet.id, 'blocked')}
                            className="pib-btn-ghost text-sm"
                          >
                            Block packet
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-headline text-xl font-semibold text-on-surface">Release plans</h2>
              <span className="rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                {releasePlans.length} plan{releasePlans.length === 1 ? '' : 's'}
              </span>
            </div>
            {releasePlans.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No approved release plans yet.</div>
            ) : (
              <div className="grid gap-3">
                {releasePlans.map((plan) => (
                  <article key={plan.id ?? `${plan.videoProjectId}-${plan.publishingPacketId}`} className="pib-card-section space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-on-surface">
                          {plan.publicSummary || releasePlanTitle(plan, packets)}
                        </h3>
                        <p className="mt-1 text-sm text-on-surface-variant">
                          {formatToken(plan.mode)} / {formatToken(plan.status)} / {formatToken(plan.targetVisibility)}
                        </p>
                      </div>
                      <StatusPill status={plan.status} />
                    </div>
                    {plan.scheduledPublishAt ? (
                      <p className="break-words text-sm text-on-surface-variant">scheduled for {String(plan.scheduledPublishAt)}</p>
                    ) : null}
                    {plan.internalNotes ? (
                      <p className="break-words text-sm text-on-surface-variant">{plan.internalNotes}</p>
                    ) : null}
                    <div className="grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
                      {releasePlanGateEntries(plan).map(([key, check]) => (
                        <span key={key} className="min-w-0 break-words">
                          {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-headline text-xl font-semibold text-on-surface">Hermes production jobs</h2>
              <span className="rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                {jobs.length} job packet{jobs.length === 1 ? '' : 's'}
              </span>
            </div>
            {jobs.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No Hermes production jobs queued yet.</div>
            ) : (
              <div className="grid gap-3">
                {jobs.map((job) => (
                  <article key={job.id ?? `${job.skillKey}-${job.title}`} className="pib-card-section space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-on-surface">{job.title}</h3>
                        <p className="mt-1 text-sm text-on-surface-variant">{skillLabel(job.skillKey)}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                        {formatToken(job.status)}
                      </span>
                    </div>
                    {job.inputSummary ? (
                      <p className="break-words text-sm text-on-surface-variant">{job.inputSummary}</p>
                    ) : null}
                    {job.blockedReason ? (
                      <p className="break-words text-sm font-medium text-error">{job.blockedReason}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-headline text-xl font-semibold text-on-surface">Analytics feedback</h2>
              <span className="rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                {analytics.length} snapshot{analytics.length === 1 ? '' : 's'}
              </span>
            </div>
            {analytics.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube analytics snapshots imported yet.</div>
            ) : (
              <div className="grid gap-3">
                {analytics.slice(0, 5).map((snapshot) => (
                  <article key={snapshot.id ?? `${snapshot.channelWorkspaceId}-${snapshot.periodEnd}`} className="pib-card-section space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-on-surface">{snapshot.clientSummary || 'Analytics snapshot'}</h3>
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
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <form onSubmit={saveChannel} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Add channel</h2>
            <Field label="Channel title" value={form.channelTitle} onChange={(value) => update('channelTitle', value)} required />
            <Field label="YouTube handle" value={form.youtubeHandle} onChange={(value) => update('youtubeHandle', value)} />
            <TextArea
              label="Content pillars"
              value={form.contentPillars}
              onChange={(value) => update('contentPillars', value)}
              placeholder="One per line or comma-separated"
            />
            <TextArea label="Audience notes" value={form.audienceNotes} onChange={(value) => update('audienceNotes', value)} />
            <button type="submit" disabled={saving || !form.channelTitle.trim()} className="pib-btn-primary w-full">
              {saving ? 'Saving...' : 'Save channel'}
            </button>
          </form>

          <form onSubmit={savePublishingReadiness} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Publishing readiness</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Channel</span>
              <select
                value={form.readinessChannelId}
                onChange={(event) => update('readinessChannelId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select a channel</option>
                {channels.map((channel) => (
                  <option key={channel.id ?? channel.title} value={channel.id ?? ''}>{channel.title}</option>
                ))}
              </select>
            </label>
            <Field
              label="Connected account ID"
              value={form.readinessConnectedAccountId}
              onChange={(value) => update('readinessConnectedAccountId', value)}
            />
            <Select
              label="Account status"
              value={form.readinessAccountStatus}
              onChange={(value) => update('readinessAccountStatus', value as YouTubeConnectedAccountStatus)}
              options={connectedAccountStatuses}
            />
            <Select
              label="API project"
              value={form.readinessApiProjectStatus}
              onChange={(value) => update('readinessApiProjectStatus', value as YouTubeApiProjectStatus)}
              options={apiProjectStatuses}
            />
            <Select
              label="Readiness"
              value={form.readinessLevel}
              onChange={(value) => update('readinessLevel', value as YouTubePublishingReadinessLevel)}
              options={publishingReadinessLevels}
            />
            <Select
              label="Default privacy"
              value={form.readinessDefaultPrivacy}
              onChange={(value) => update('readinessDefaultPrivacy', value as YouTubePublishingPolicy['defaultVisibility'])}
              options={publishingVisibilities}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Daily quota"
                value={form.readinessQuotaDailyLimit}
                onChange={(value) => update('readinessQuotaDailyLimit', value)}
                type="number"
              />
              <Field
                label="Quota left"
                value={form.readinessQuotaUnitsRemaining}
                onChange={(value) => update('readinessQuotaUnitsRemaining', value)}
                type="number"
              />
            </div>
            <TextArea label="Readiness notes" value={form.readinessNotes} onChange={(value) => update('readinessNotes', value)} />
            <button type="submit" disabled={savingReadiness || !form.readinessChannelId} className="pib-btn-primary w-full">
              {savingReadiness ? 'Saving...' : 'Save readiness'}
            </button>
          </form>

          <form onSubmit={saveVideo} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Start video</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Channel</span>
              <select
                value={form.videoChannelId}
                onChange={(event) => update('videoChannelId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select a channel</option>
                {channels.map((channel) => (
                  <option key={channel.id ?? channel.title} value={channel.id ?? ''}>{channel.title}</option>
                ))}
              </select>
            </label>
            <Field label="Video title" value={form.videoTitle} onChange={(value) => update('videoTitle', value)} required />
            <TextArea label="Objective" value={form.objective} onChange={(value) => update('objective', value)} />
            <Select
              label="Video type"
              value={form.videoType}
              onChange={(value) => update('videoType', value as YouTubeVideoType)}
              options={videoTypes}
            />
            <Field label="Source URL" value={form.sourceUrl} onChange={(value) => update('sourceUrl', value)} />
            <button type="submit" disabled={saving || !form.videoChannelId || !form.videoTitle.trim()} className="pib-btn-primary w-full">
              {saving ? 'Saving...' : 'Create video project'}
            </button>
          </form>

          <form onSubmit={createSourceAsset} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Add source asset</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Asset channel</span>
              <select
                value={form.assetChannelId}
                onChange={(event) => selectAssetChannel(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select a channel</option>
                {channels.map((channel) => (
                  <option key={channel.id ?? channel.title} value={channel.id ?? ''}>{channel.title}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Asset video</span>
              <select
                value={form.assetVideoId}
                onChange={(event) => selectAssetVideo(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Channel-level asset</option>
                {assetVideoOptions.map((video) => (
                  <option key={video.id ?? video.title} value={video.id ?? ''}>{video.title}</option>
                ))}
              </select>
            </label>
            <Field label="Asset title" value={form.assetTitle} onChange={(value) => update('assetTitle', value)} required />
            <Select
              label="Asset type"
              value={form.assetType}
              onChange={(value) => update('assetType', value as YouTubeSourceAssetType)}
              options={sourceAssetTypes}
            />
            <Field label="Asset URL" value={form.assetUrl} onChange={(value) => update('assetUrl', value)} />
            <Field
              label="Duration seconds"
              value={form.assetDurationSeconds}
              onChange={(value) => update('assetDurationSeconds', value)}
              type="number"
            />
            <TextArea label="Client asset notes" value={form.assetClientNotes} onChange={(value) => update('assetClientNotes', value)} />
            <label className="flex items-center gap-2 text-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={form.assetShowInPortal}
                onChange={(event) => update('assetShowInPortal', event.target.checked)}
                className="h-4 w-4"
              />
              Show asset in portal
            </label>
            <button type="submit" disabled={addingSourceAsset || !form.assetChannelId || !form.assetTitle.trim()} className="pib-btn-primary w-full">
              {addingSourceAsset ? 'Adding...' : 'Add source asset'}
            </button>
          </form>

          <form onSubmit={createClipCandidate} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Create clip</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Clip source asset</span>
              <select
                value={form.clipSourceAssetId}
                onChange={(event) => selectClipSourceAsset(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select source footage</option>
                {sourceAssets.map((asset) => (
                  <option key={asset.id ?? asset.title} value={asset.id ?? ''}>{asset.title}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Clip video</span>
              <select
                value={form.clipVideoId}
                onChange={(event) => update('clipVideoId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Use source asset video</option>
                {clipVideoOptions.map((video) => (
                  <option key={video.id ?? video.title} value={video.id ?? ''}>{video.title}</option>
                ))}
              </select>
            </label>
            <Field label="Clip title" value={form.clipTitle} onChange={(value) => update('clipTitle', value)} required />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start" value={form.clipStart} onChange={(value) => update('clipStart', value)} placeholder="02:00" />
              <Field label="End" value={form.clipEnd} onChange={(value) => update('clipEnd', value)} placeholder="02:58" />
            </div>
            <Select
              label="Target format"
              value={form.clipTargetFormat}
              onChange={(value) => update('clipTargetFormat', value as YouTubeClipTargetFormat)}
              options={clipTargetFormats}
            />
            <TextArea label="Clip summary" value={form.clipSummary} onChange={(value) => update('clipSummary', value)} />
            <Field label="Clip hook" value={form.clipHook} onChange={(value) => update('clipHook', value)} />
            <TextArea
              label="Clip transcript excerpt"
              value={form.clipTranscriptExcerpt}
              onChange={(value) => update('clipTranscriptExcerpt', value)}
            />
            <label className="flex items-center gap-2 text-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={form.clipShowInPortal}
                onChange={(event) => update('clipShowInPortal', event.target.checked)}
                className="h-4 w-4"
              />
              Show clip in portal
            </label>
            <button type="submit" disabled={creatingClipCandidate || !form.clipSourceAssetId || !form.clipTitle.trim()} className="pib-btn-primary w-full">
              {creatingClipCandidate ? 'Creating...' : 'Create clip candidate'}
            </button>
          </form>

          <form onSubmit={queueAgentJob} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Queue Hermes job</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Video</span>
              <select
                value={form.jobVideoId}
                onChange={(event) => update('jobVideoId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select a video</option>
                {videos.map((video) => (
                  <option key={video.id ?? video.title} value={video.id ?? ''}>{video.title}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Skill</span>
              <select
                value={form.jobSkillKey}
                onChange={(event) => update('jobSkillKey', event.target.value as YouTubeProductionSkillKey)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                {YOUTUBE_PRODUCTION_SKILLS.map((skill) => (
                  <option key={skill.key} value={skill.key}>{skill.label}</option>
                ))}
              </select>
            </label>
            <TextArea
              label="Input summary"
              value={form.jobInputSummary}
              onChange={(value) => update('jobInputSummary', value)}
            />
            <button type="submit" disabled={queueingJob || !form.jobVideoId} className="pib-btn-primary w-full">
              {queueingJob ? 'Queueing...' : 'Queue job packet'}
            </button>
          </form>

          <form onSubmit={createPublishingPacket} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Create packet</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Video</span>
              <select
                value={form.packetVideoId}
                onChange={(event) => update('packetVideoId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select a video</option>
                {videos.map((video) => (
                  <option key={video.id ?? video.title} value={video.id ?? ''}>{video.title}</option>
                ))}
              </select>
            </label>
            <Field label="Primary title" value={form.packetTitle} onChange={(value) => update('packetTitle', value)} />
            <TextArea label="Description" value={form.packetDescription} onChange={(value) => update('packetDescription', value)} />
            <TextArea
              label="Tags"
              value={form.packetTags}
              onChange={(value) => update('packetTags', value)}
              placeholder="One per line or comma-separated"
            />
            <TextArea
              label="Chapters"
              value={form.packetChapters}
              onChange={(value) => update('packetChapters', value)}
              placeholder="00:00 Intro"
            />
            <label className="flex items-center gap-2 text-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={form.packetMadeForKids}
                onChange={(event) => update('packetMadeForKids', event.target.checked)}
                className="h-4 w-4"
              />
              Self-declared made for kids
            </label>
            <label className="flex items-center gap-2 text-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={form.packetContainsSyntheticMedia}
                onChange={(event) => update('packetContainsSyntheticMedia', event.target.checked)}
                className="h-4 w-4"
              />
              Contains altered or synthetic media
            </label>
            <TextArea
              label="AI disclosure notes"
              value={form.packetAiDisclosureNotes}
              onChange={(value) => update('packetAiDisclosureNotes', value)}
            />
            <button type="submit" disabled={creatingPacket || !form.packetVideoId} className="pib-btn-primary w-full">
              {creatingPacket ? 'Creating...' : 'Create private packet'}
            </button>
          </form>

          <form onSubmit={createReleasePlan} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Plan release</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Approved packet</span>
              <select
                value={form.releasePacketId}
                onChange={(event) => update('releasePacketId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select an approved packet</option>
                {approvedPackets.map((packet) => (
                  <option key={packet.id ?? packetTitle(packet)} value={packet.id ?? ''}>{packetTitle(packet)}</option>
                ))}
              </select>
            </label>
            <Select
              label="Release mode"
              value={form.releaseMode}
              onChange={(value) => update('releaseMode', value as YouTubeReleaseMode)}
              options={releaseModes}
            />
            <Select
              label="Target visibility"
              value={form.releaseTargetVisibility}
              onChange={(value) => update('releaseTargetVisibility', value as YouTubePublishingPolicy['defaultVisibility'])}
              options={publishingVisibilities}
            />
            <Field
              label="Scheduled publish time"
              value={form.releaseScheduledPublishAt}
              onChange={(value) => update('releaseScheduledPublishAt', value)}
              placeholder="2026-06-20T10:00:00Z"
            />
            <TextArea
              label="Public summary"
              value={form.releasePublicSummary}
              onChange={(value) => update('releasePublicSummary', value)}
            />
            <TextArea
              label="Internal release notes"
              value={form.releaseInternalNotes}
              onChange={(value) => update('releaseInternalNotes', value)}
            />
            <button type="submit" disabled={creatingReleasePlan || !form.releasePacketId} className="pib-btn-primary w-full">
              {creatingReleasePlan ? 'Creating...' : 'Create release plan'}
            </button>
          </form>

          <form onSubmit={importAnalytics} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Import analytics</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Channel</span>
              <select
                value={form.analyticsChannelId}
                onChange={(event) => selectAnalyticsChannel(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select a channel</option>
                {channels.map((channel) => (
                  <option key={channel.id ?? channel.title} value={channel.id ?? ''}>{channel.title}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Video</span>
              <select
                value={form.analyticsVideoId}
                onChange={(event) => selectAnalyticsVideo(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Channel snapshot</option>
                {analyticsVideoOptions.map((video) => (
                  <option key={video.id ?? video.title} value={video.id ?? ''}>{video.title}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Period start"
                value={form.analyticsPeriodStart}
                onChange={(value) => update('analyticsPeriodStart', value)}
                required
                type="date"
              />
              <Field
                label="Period end"
                value={form.analyticsPeriodEnd}
                onChange={(value) => update('analyticsPeriodEnd', value)}
                required
                type="date"
              />
            </div>
            <Select
              label="Source"
              value={form.analyticsSource}
              onChange={(value) => update('analyticsSource', value as YouTubeAnalyticsSource)}
              options={analyticsSources}
            />
            <Select
              label="Freshness"
              value={form.analyticsFreshness}
              onChange={(value) => update('analyticsFreshness', value as YouTubeAnalyticsFreshness)}
              options={analyticsFreshnessOptions}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Views" value={form.analyticsViews} onChange={(value) => update('analyticsViews', value)} type="number" />
              <Field
                label="Watch minutes"
                value={form.analyticsWatchTimeMinutes}
                onChange={(value) => update('analyticsWatchTimeMinutes', value)}
                type="number"
              />
              <Field
                label="Avg viewed %"
                value={form.analyticsAverageViewPercentage}
                onChange={(value) => update('analyticsAverageViewPercentage', value)}
                type="number"
              />
              <Field label="CTR %" value={form.analyticsImpressionsCtr} onChange={(value) => update('analyticsImpressionsCtr', value)} type="number" />
            </div>
            <TextArea label="Client summary" value={form.analyticsClientSummary} onChange={(value) => update('analyticsClientSummary', value)} />
            <Select
              label="Recommendation type"
              value={form.analyticsRecommendationType}
              onChange={(value) => update('analyticsRecommendationType', value as YouTubeAnalyticsRecommendationType)}
              options={analyticsRecommendationTypes}
            />
            <Select
              label="Confidence"
              value={form.analyticsRecommendationConfidence}
              onChange={(value) => update('analyticsRecommendationConfidence', value as YouTubeAnalyticsRecommendationConfidence)}
              options={analyticsRecommendationConfidences}
            />
            <TextArea
              label="Recommendation"
              value={form.analyticsRecommendationSummary}
              onChange={(value) => update('analyticsRecommendationSummary', value)}
            />
            <label className="flex items-center gap-2 text-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={form.analyticsShowInPortal}
                onChange={(event) => update('analyticsShowInPortal', event.target.checked)}
                className="h-4 w-4"
              />
              Show client-safe summary in portal
            </label>
            <button
              type="submit"
              disabled={importingAnalytics || !form.analyticsChannelId || !form.analyticsPeriodStart || !form.analyticsPeriodEnd}
              className="pib-btn-primary w-full"
            >
              {importingAnalytics ? 'Importing...' : 'Import snapshot'}
            </button>
          </form>
        </aside>
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

function skillLabel(key: YouTubeProductionSkillKey) {
  return YOUTUBE_PRODUCTION_SKILLS.find((skill) => skill.key === key)?.label ?? formatToken(key)
}

function packetTitle(packet: YouTubePublishingPacket) {
  return packet.titleOptions?.find((option) => option.selected)?.text ?? packet.titleOptions?.[0]?.text ?? 'Untitled publishing packet'
}

function packetGateEntries(packet: YouTubePublishingPacket) {
  return Object.entries(packet.checks ?? {}) as Array<[
    keyof YouTubePublishingPacket['checks'],
    YouTubePublishingPacket['checks'][keyof YouTubePublishingPacket['checks']],
  ]>
}

function releasePlanTitle(plan: YouTubeReleasePlan, packets: YouTubePublishingPacket[]) {
  const packet = packets.find((item) => item.id === plan.publishingPacketId)
  return packet ? packetTitle(packet) : 'YouTube release plan'
}

function releasePlanGateEntries(plan: YouTubeReleasePlan) {
  return Object.entries(plan.checks ?? {}) as Array<[
    keyof YouTubeReleasePlan['checks'],
    YouTubeReleasePlan['checks'][keyof YouTubeReleasePlan['checks']],
  ]>
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

function packetStatusNotice(status: Exclude<YouTubePublishingPacket['status'], 'published'>) {
  if (status === 'client_review') return 'Publishing packet sent to the client portal.'
  if (status === 'approved') return 'Publishing packet approved.'
  if (status === 'blocked') return 'Publishing packet blocked.'
  if (status === 'internal_review') return 'Publishing packet moved to internal review.'
  return 'Publishing packet returned to draft.'
}

function formatToken(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase()
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  type?: 'date' | 'number' | 'text'
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
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
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      />
    </label>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
        ))}
      </select>
    </label>
  )
}
