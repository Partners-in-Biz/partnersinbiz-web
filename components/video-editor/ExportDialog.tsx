'use client'

import { estimateEditorRenderCredits } from '@/lib/video-editor/credits'
import type { EditorTimeline, VideoEditorProjectSettings, VideoEditorRenderJob } from '@/lib/video-editor/types'

export function ExportDialog({
  projectId,
  timeline,
  settings,
  latestJob,
  busy,
  onRender,
}: {
  projectId: string
  timeline: EditorTimeline
  settings: VideoEditorProjectSettings
  latestJob?: VideoEditorRenderJob & { id: string }
  busy: boolean
  onRender: () => void
}) {
  const estimate = estimateEditorRenderCredits(timeline, settings)
  const canRender = Boolean(projectId) && estimate.outputSeconds > 0
  const renderBlocker = !projectId
    ? 'Open a saved editor project before rendering.'
    : estimate.outputSeconds <= 0
      ? 'Add at least one media clip or text title clip before rendering.'
      : ''
  return (
    <section className="pib-card-section space-y-3 p-4">
      <h2 className="font-headline text-lg text-[var(--color-pib-text)]">Export</h2>
      <div className="grid grid-cols-3 gap-2 text-center text-xs text-[var(--color-pib-text-muted)]">
        <span className="rounded-lg bg-white/[0.04] p-2">{estimate.outputSeconds}s</span>
        <span className="rounded-lg bg-white/[0.04] p-2">{estimate.billedMinutes} min</span>
        <span className="rounded-lg bg-white/[0.04] p-2">{estimate.credits} credits</span>
      </div>
      {renderBlocker ? <p className="text-sm text-[var(--color-pib-text-muted)]">{renderBlocker}</p> : null}
      <button type="button" className="pib-btn-primary w-full justify-center" disabled={busy || !canRender} onClick={onRender}>
        {busy ? 'Rendering...' : 'Render MP4'}
      </button>
      {latestJob ? (
        <div className="space-y-2 text-sm text-[var(--color-pib-text-muted)]">
          <p>Status: {latestJob.status}</p>
          {latestJob.output?.url ? <a className="text-[var(--color-pib-primary)]" href={latestJob.output.url} target="_blank" rel="noreferrer">Download rendered MP4</a> : null}
        </div>
      ) : null}
    </section>
  )
}
