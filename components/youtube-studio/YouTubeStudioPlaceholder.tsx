type YouTubeStudioSurface = 'admin' | 'portal'

interface YouTubeStudioPlaceholderProps {
  surface: YouTubeStudioSurface
  orgName?: string
}

const adminSteps = [
  {
    title: 'Channel workspace',
    description: 'Create the channel profile, series structure, and operating brief before production data is added.',
  },
  {
    title: 'Publishing gates',
    description: 'Stage draft reviews, compliance checks, publishing packets, and final PiB approval before anything goes live.',
  },
  {
    title: 'Analytics foundation',
    description: 'Prepare client-safe reporting for retention, reach, watch time, and follow-up production decisions.',
  },
]

const portalSteps = [
  {
    title: 'Video requests',
    description: 'Clients will be able to submit channel video requests and priorities for PiB production review.',
  },
  {
    title: 'Draft reviews',
    description: 'Upcoming drafts, thumbnails, titles, and publishing packet approvals will appear here when enabled.',
  },
  {
    title: 'Client-safe analytics',
    description: 'Approved channel performance summaries will live here without exposing internal production controls.',
  },
]

export function YouTubeStudioPlaceholder({ surface, orgName }: YouTubeStudioPlaceholderProps) {
  const isAdmin = surface === 'admin'
  const steps = isAdmin ? adminSteps : portalSteps
  const eyebrow = isAdmin && orgName ? `${orgName} / Production cockpit` : 'Production cockpit'
  const description = isAdmin
    ? 'Set up channel workspaces, series planning, review gates, and publishing foundations for YouTube delivery.'
    : 'Review channel video requests, draft approvals, publishing packets, and client-safe YouTube analytics as PiB rolls out this module.'

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="text-3xl font-headline font-bold text-[var(--color-pib-text)]">YouTube Studio</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">{description}</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] px-3 py-1.5 text-xs font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">smart_display</span>
          Phase 1 foundation
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        {steps.map((step) => (
          <article key={step.title} className="pib-card space-y-2">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">{step.title}</p>
            <p className="text-sm text-[var(--color-pib-text-muted)]">{step.description}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-5">
        <p className="text-sm font-semibold text-[var(--color-pib-text)]">Coming next</p>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          This route is intentionally a lightweight shell for Phase 1. Data models, APIs, request/review workflows,
          publishing controls, and YouTube integrations will be added in the following implementation tasks.
        </p>
      </section>
    </main>
  )
}
