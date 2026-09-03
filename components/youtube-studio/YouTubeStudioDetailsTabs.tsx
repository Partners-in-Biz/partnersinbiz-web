'use client'

import { useMemo, useState } from 'react'
import type {
  YouTubeAnalyticsSnapshot,
  YouTubeClipCandidate,
  YouTubeProductionDraft,
  YouTubePublishingPacket,
  YouTubeReleasePlan,
  YouTubeRenderJob,
  YouTubeSourceAsset,
} from '@/lib/youtube-studio/types'

type ClientDecision = 'approved' | 'changes_requested' | 'rejected'
type DetailsTabKey = 'source_assets' | 'clips' | 'drafts' | 'renders' | 'packets' | 'release_plans' | 'analytics'

export interface YouTubeStudioDetailsTabsProps {
  sourceAssets: YouTubeSourceAsset[]
  clipCandidates: YouTubeClipCandidate[]
  productionDrafts: YouTubeProductionDraft[]
  renderJobs: YouTubeRenderJob[]
  packets: YouTubePublishingPacket[]
  releasePlans: YouTubeReleasePlan[]
  analytics: YouTubeAnalyticsSnapshot[]
  canReviewApprovals: boolean
  draftNotes: Record<string, string>
  renderNotes: Record<string, string>
  packetNotes: Record<string, string>
  reviewingDraftId: string | null
  reviewingRenderId: string | null
  reviewingPacketId: string | null
  onDraftNotesChange: (id: string, value: string) => void
  onRenderNotesChange: (id: string, value: string) => void
  onPacketNotesChange: (id: string, value: string) => void
  onDraftDecision: (id: string, decision: ClientDecision) => void
  onRenderDecision: (id: string, decision: ClientDecision) => void
  onPacketDecision: (id: string, decision: ClientDecision) => void
}

export function YouTubeStudioDetailsTabs(props: YouTubeStudioDetailsTabsProps) {
  const tabs = useMemo(() => {
    const definitions: Array<{ key: DetailsTabKey; label: string; count: number }> = [
      { key: 'source_assets', label: 'Source assets', count: props.sourceAssets.length },
      { key: 'clips', label: 'Clip candidates', count: props.clipCandidates.length },
      { key: 'drafts', label: 'Drafts', count: props.productionDrafts.length },
      { key: 'renders', label: 'Renders', count: props.renderJobs.length },
      { key: 'packets', label: 'Publishing packets', count: props.packets.length },
      { key: 'release_plans', label: 'Release plans', count: props.releasePlans.length },
      { key: 'analytics', label: 'Analytics', count: props.analytics.length },
    ]
    return definitions.filter((tab) => tab.count > 0)
  }, [props.sourceAssets, props.clipCandidates, props.productionDrafts, props.renderJobs, props.packets, props.releasePlans, props.analytics])

  const [requestedTab, setRequestedTab] = useState<DetailsTabKey | null>(null)
  if (tabs.length === 0) return null
  const activeTab = tabs.some((tab) => tab.key === requestedTab) ? requestedTab! : tabs[0].key

  return (
    <section className="space-y-3">
      <h2 className="font-headline text-xl text-[var(--color-pib-text)]">Production details</h2>
      <div role="tablist" aria-label="Production details" className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === activeTab}
            onClick={() => setRequestedTab(tab.key)}
            className={tab.key === activeTab ? 'pib-btn-primary text-sm' : 'pib-btn-ghost text-sm'}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {activeTab === 'source_assets' ? <SourceAssetsTabContent assets={props.sourceAssets} /> : null}
        {activeTab === 'clips' ? <ClipCandidatesTabContent clips={props.clipCandidates} /> : null}
        {activeTab === 'drafts' ? <ProductionDraftsTabContent {...props} /> : null}
        {activeTab === 'renders' ? <RenderJobsTabContent {...props} /> : null}
        {activeTab === 'packets' ? <PacketsTabContent {...props} /> : null}
        {activeTab === 'release_plans' ? <ReleasePlansTabContent plans={props.releasePlans} /> : null}
        {activeTab === 'analytics' ? <AnalyticsTabContent analytics={props.analytics} /> : null}
      </div>
    </section>
  )
}

function SourceAssetsTabContent({ assets }: { assets: YouTubeSourceAsset[] }) {
  return (
    <div className="space-y-3">
      {assets.map((asset) => (
        <article key={asset.id ?? asset.title} className="pib-card-section space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-[var(--color-pib-text)]">{asset.title}</h3>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{sourceAssetMeta(asset)}</p>
            </div>
          </div>
          {asset.clientNotes ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{asset.clientNotes}</p> : null}
          {asset.rights?.status ? (
            <p className="break-words text-xs text-[var(--color-pib-text-muted)]">rights: {formatToken(asset.rights.status)}</p>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function ClipCandidatesTabContent({ clips }: { clips: YouTubeClipCandidate[] }) {
  return (
    <div className="space-y-3">
      {clips.map((clip) => (
        <article key={clip.id ?? `${clip.sourceAssetId}-${clip.startSeconds}`} className="pib-card-section space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-[var(--color-pib-text)]">{clip.title}</h3>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{clipMeta(clip)}</p>
            </div>
          </div>
          {clip.summary ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{clip.summary}</p> : null}
          {clip.hook ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{clip.hook}</p> : null}
          {clip.transcriptExcerpt ? <p className="break-words text-xs text-[var(--color-pib-text-muted)]">{clip.transcriptExcerpt}</p> : null}
          <div className="grid gap-2 text-xs text-[var(--color-pib-text-muted)] sm:grid-cols-2">
            {clipGateEntries(clip).map(([key, check]) => (
              <span key={key} className="min-w-0 break-words">
                {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
              </span>
            ))}
          </div>
        </article>
      ))}
    </div>
  )
}

function ProductionDraftsTabContent({
  productionDrafts,
  canReviewApprovals,
  draftNotes,
  reviewingDraftId,
  onDraftNotesChange,
  onDraftDecision,
}: YouTubeStudioDetailsTabsProps) {
  return (
    <div className="space-y-3">
      {productionDrafts.map((draft) => (
        <article key={draft.id ?? `${draft.videoProjectId}-${draft.versionNumber}`} className="pib-card-section space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-[var(--color-pib-text)]">{draft.title}</h3>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{productionDraftMeta(draft)}</p>
            </div>
          </div>
          {draft.summary ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{draft.summary}</p> : null}
          {draft.hook ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{draft.hook}</p> : null}
          {draft.outline?.length ? (
            <div className="flex flex-wrap gap-2">
              {draft.outline.slice(0, 6).map((item) => (
                <span key={item} className="pib-pill pib-pill-rose max-w-full break-words">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          {draft.scriptText ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{draft.scriptText}</p> : null}
          {draft.scenes?.length ? (
            <div className="grid gap-2">
              {draft.scenes.slice(0, 3).map((scene, index) => (
                <div key={`${scene.label}-${index}`} className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm text-[var(--color-pib-text-muted)]">
                  <p className="font-medium text-[var(--color-pib-text)]">{productionSceneMeta(scene)}</p>
                  {scene.summary ? <p className="mt-1 break-words">{scene.summary}</p> : null}
                  {scene.voiceover ? <p className="mt-1 break-words">{scene.voiceover}</p> : null}
                  {scene.visualNotes ? <p className="mt-1 break-words">{scene.visualNotes}</p> : null}
                  {scene.onScreenText ? <p className="mt-1 break-words">{scene.onScreenText}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid gap-2 text-xs text-[var(--color-pib-text-muted)] sm:grid-cols-2">
            {productionDraftGateEntries(draft).map(([key, check]) => (
              <span key={key} className="min-w-0 break-words">
                {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
              </span>
            ))}
          </div>
          {draft.clientNotes ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{draft.clientNotes}</p> : null}
          {canReviewApprovals && draft.id && draft.status === 'client_review' ? (
            <div className="space-y-3">
              <textarea
                rows={3}
                disabled={reviewingDraftId === draft.id}
                value={draftNotes[draft.id] ?? ''}
                onChange={(event) => onDraftNotesChange(draft.id!, event.target.value)}
                placeholder="Draft notes for PiB"
                className="w-full rounded-[6px] border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
               aria-label="Draft notes for PiB"/>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(reviewingDraftId)}
                  onClick={() => onDraftDecision(draft.id!, 'approved')}
                  className="pib-btn-primary text-sm"
                >
                  Approve draft
                </button>
                <button
                  type="button"
                  disabled={Boolean(reviewingDraftId)}
                  onClick={() => onDraftDecision(draft.id!, 'changes_requested')}
                  className="pib-btn-ghost text-sm"
                >
                  Request draft changes
                </button>
                <button
                  type="button"
                  disabled={Boolean(reviewingDraftId)}
                  onClick={() => onDraftDecision(draft.id!, 'rejected')}
                  className="pib-btn-ghost text-sm"
                >
                  Reject draft
                </button>
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function RenderJobsTabContent({
  renderJobs,
  canReviewApprovals,
  renderNotes,
  reviewingRenderId,
  onRenderNotesChange,
  onRenderDecision,
}: YouTubeStudioDetailsTabsProps) {
  return (
    <div className="space-y-3">
      {renderJobs.map((job) => (
        <article key={job.id ?? `${job.videoProjectId}-${job.versionNumber}`} className="pib-card-section space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-[var(--color-pib-text)]">{job.title}</h3>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{renderJobMeta(job)}</p>
            </div>
          </div>
          {job.editBrief ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{job.editBrief}</p> : null}
          {job.timeline?.length ? (
            <div className="grid gap-2">
              {job.timeline.slice(0, 3).map((scene, index) => (
                <div key={`${scene.label}-${index}`} className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm text-[var(--color-pib-text-muted)]">
                  <p className="font-medium text-[var(--color-pib-text)]">{renderTimelineMeta(scene)}</p>
                  {scene.summary ? <p className="mt-1 break-words">{scene.summary}</p> : null}
                  {scene.voiceover ? <p className="mt-1 break-words">{scene.voiceover}</p> : null}
                  {scene.onScreenText ? <p className="mt-1 break-words">{scene.onScreenText}</p> : null}
                  {scene.editNotes ? <p className="mt-1 break-words">{scene.editNotes}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid gap-2 text-xs text-[var(--color-pib-text-muted)] sm:grid-cols-2">
            {renderJobGateEntries(job).map(([key, check]) => (
              <span key={key} className="min-w-0 break-words">
                {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
              </span>
            ))}
          </div>
          {job.output?.previewUrl || job.output?.downloadUrl ? (
            <p className="break-words text-sm text-[var(--color-pib-text-muted)]">
              {job.output.previewUrl ? 'preview ready' : 'download ready'}
              {typeof job.output.durationSeconds === 'number' ? ` / ${job.output.durationSeconds}s` : ''}
            </p>
          ) : null}
          {job.clientNotes ? <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{job.clientNotes}</p> : null}
          {canReviewApprovals && job.id && job.status === 'qa_review' ? (
            <div className="space-y-3">
              <textarea
                rows={3}
                disabled={reviewingRenderId === job.id}
                value={renderNotes[job.id] ?? ''}
                onChange={(event) => onRenderNotesChange(job.id!, event.target.value)}
                placeholder="Render notes for PiB"
                className="w-full rounded-[6px] border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
               aria-label="Render notes for PiB"/>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={Boolean(reviewingRenderId)} onClick={() => onRenderDecision(job.id!, 'approved')} className="pib-btn-primary text-sm">Approve render</button>
                <button type="button" disabled={Boolean(reviewingRenderId)} onClick={() => onRenderDecision(job.id!, 'changes_requested')} className="pib-btn-ghost text-sm">Request render changes</button>
                <button type="button" disabled={Boolean(reviewingRenderId)} onClick={() => onRenderDecision(job.id!, 'rejected')} className="pib-btn-ghost text-sm">Reject render</button>
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function PacketsTabContent({
  packets,
  canReviewApprovals,
  packetNotes,
  reviewingPacketId,
  onPacketNotesChange,
  onPacketDecision,
}: YouTubeStudioDetailsTabsProps) {
  return (
    <div className="space-y-3">
      {packets.map((packet) => (
        <article key={packet.id ?? `${packet.videoProjectId}-${packet.versionNumber}`} className="pib-card-section space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-[var(--color-pib-text)]">{packetTitle(packet)}</h3>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                Version {packet.versionNumber || 1} / {formatToken(packet.status)} / {formatToken(packet.visibility)}
              </p>
            </div>
            <span className="pib-pill pib-pill-rose shrink-0">
              {packet.chapters?.length ?? 0} chapters
            </span>
          </div>
          {packet.description ? (
            <p className="break-words text-sm text-[var(--color-pib-text-muted)]">{packet.description}</p>
          ) : null}
          {packet.tags?.length ? (
            <div className="flex flex-wrap gap-2">
              {packet.tags.slice(0, 8).map((tag) => (
                <span key={tag} className="pib-pill pib-pill-rose max-w-full break-words">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          <div className="grid gap-2 text-xs text-[var(--color-pib-text-muted)] sm:grid-cols-2">
            {packetGateEntries(packet).map(([key, check]) => (
              <span key={key} className="min-w-0 break-words">
                {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
              </span>
            ))}
          </div>
          {canReviewApprovals && packet.id && packet.status === 'client_review' ? (
            <div className="space-y-3">
              <textarea
                rows={3}
                disabled={reviewingPacketId === packet.id}
                value={packetNotes[packet.id] ?? ''}
                onChange={(event) => onPacketNotesChange(packet.id!, event.target.value)}
                placeholder="Packet notes for PiB"
                className="w-full rounded-[6px] border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
               aria-label="Packet notes for PiB"/>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(reviewingPacketId)}
                  onClick={() => onPacketDecision(packet.id!, 'approved')}
                  className="pib-btn-primary text-sm"
                >
                  Approve packet
                </button>
                <button
                  type="button"
                  disabled={Boolean(reviewingPacketId)}
                  onClick={() => onPacketDecision(packet.id!, 'changes_requested')}
                  className="pib-btn-ghost text-sm"
                >
                  Request packet changes
                </button>
                <button
                  type="button"
                  disabled={Boolean(reviewingPacketId)}
                  onClick={() => onPacketDecision(packet.id!, 'rejected')}
                  className="pib-btn-ghost text-sm"
                >
                  Reject packet
                </button>
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function ReleasePlansTabContent({ plans }: { plans: YouTubeReleasePlan[] }) {
  return (
    <div className="space-y-3">
      {plans.map((plan) => (
        <article key={plan.id ?? `${plan.videoProjectId}-${plan.publishingPacketId}`} className="pib-card-section space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-[var(--color-pib-text)]">{plan.publicSummary || 'YouTube release plan'}</h3>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                {formatToken(plan.mode)} / {formatToken(plan.status)} / {formatToken(plan.targetVisibility)}
              </p>
            </div>
            {plan.scheduledPublishAt ? (
              <span className="pib-pill pib-pill-rose shrink-0">
                scheduled
              </span>
            ) : null}
          </div>
          {plan.scheduledPublishAt ? (
            <p className="break-words text-sm text-[var(--color-pib-text-muted)]">scheduled for {String(plan.scheduledPublishAt)}</p>
          ) : null}
          <div className="grid gap-2 text-xs text-[var(--color-pib-text-muted)] sm:grid-cols-2">
            {releasePlanGateEntries(plan).map(([key, check]) => (
              <span key={key} className="min-w-0 break-words">
                {formatToken(key)}: {formatToken(check?.status ?? 'not_applicable')}
              </span>
            ))}
          </div>
        </article>
      ))}
    </div>
  )
}

function AnalyticsTabContent({ analytics }: { analytics: YouTubeAnalyticsSnapshot[] }) {
  return (
    <div className="space-y-3">
      {analytics.slice(0, 4).map((snapshot) => (
        <article key={snapshot.id ?? `${snapshot.channelWorkspaceId}-${snapshot.periodEnd}`} className="pib-card-section space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words text-[var(--color-pib-text)]">{snapshot.clientSummary || 'YouTube analytics update'}</h3>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                {snapshot.periodStart} to {snapshot.periodEnd} / {formatToken(snapshot.sourceFreshness)}
              </p>
            </div>
            <span className="pib-pill pib-pill-rose shrink-0">
              {formatToken(snapshot.source)}
            </span>
          </div>
          <div className="grid gap-2 text-sm text-[var(--color-pib-text-muted)] sm:grid-cols-4">
            <Metric label="Views" value={snapshot.metrics?.views} />
            <Metric label="Watch min" value={snapshot.metrics?.watchTimeMinutes} />
            <Metric label="Avg viewed" value={snapshot.metrics?.averageViewPercentage} suffix="%" />
            <Metric label="Retention" value={snapshot.metrics?.retentionPercentage} suffix="%" />
            <Metric label="CTR" value={snapshot.metrics?.impressionsCtr} suffix="%" />
            <Metric label="Traffic sources" value={snapshot.metrics?.trafficSources?.length} />
            <Metric label="Audience segments" value={snapshot.metrics?.audience?.length} />
            <Metric label="Compared videos" value={snapshot.metrics?.videoComparisons?.length} />
          </div>
          {snapshot.recommendations?.length ? (
            <div className="space-y-2">
              {snapshot.recommendations.slice(0, 2).map((recommendation, index) => (
                <p key={`${recommendation.type}-${index}`} className="break-words text-sm text-[var(--color-pib-text-muted)]">
                  <span className="font-medium text-[var(--color-pib-text)]">{formatToken(recommendation.type)}:</span> {recommendation.summary}
                </p>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
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
