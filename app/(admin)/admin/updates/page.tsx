import Link from 'next/link'

export const dynamic = 'force-dynamic'

type UpdateArea = {
  title: string
  eyebrow: string
  icon: string
  summary: string
  href: string
  hrefLabel: string
  steps: string[]
  checks: string[]
}

export const ADMIN_UPDATE_AREAS: UpdateArea[] = [
  {
    title: 'Mission Control and briefings',
    eyebrow: 'Daily command desk',
    icon: 'team_dashboard',
    summary: 'A single place to see urgent cards, route decisions, open evidence, assign agents, and turn platform signals into follow-up work.',
    href: '/admin/briefings',
    hrefLabel: 'Open Briefings',
    steps: [
      'Start here each morning and scan the urgent and unread cards first.',
      'Open the evidence link before approving, rejecting, snoozing, or creating a task.',
      'If a card needs specialist work, create or assign the task rather than leaving the decision in chat.',
    ],
    checks: [
      'Client-visible sends, publishing, finance, secrets, destructive actions, spend, and production deploys still need separate explicit approval.',
      'Done agent tasks can still be review work; open the source task before treating them as blocked.',
    ],
  },
  {
    title: 'Admin dashboard',
    eyebrow: 'Operator overview',
    icon: 'space_dashboard',
    summary: 'The dashboard now acts as the top-level operating map for clients, live work, platform health, approvals, and recent activity.',
    href: '/admin/dashboard',
    hrefLabel: 'Open Dashboard',
    steps: [
      'Use the client fleet cards to jump into a client workspace.',
      'Use the work lanes to find pending, active, blocked, review, and completed agent work.',
      'Use activity and health panels as a quick proof check before chasing an issue elsewhere.',
    ],
    checks: [
      'If a client does not appear, check Clients before assuming the workspace is gone.',
      'Dashboard signals are navigational; action still happens in the linked task, org, or module page.',
    ],
  },
  {
    title: 'Client workspace pages',
    eyebrow: 'Client-specific operations',
    icon: 'business_center',
    summary: 'Each client workspace has clearer admin routes for overview, projects, documents, research, marketing, messages, reports, team, billing, and settings.',
    href: '/admin/clients',
    hrefLabel: 'Choose Client',
    steps: [
      'Open Clients, choose the workspace, then use the left navigation inside that client.',
      'Keep client-scoped work inside the client workspace instead of using top-level admin pages by habit.',
      'For linked CRM company work, follow the banner/source context so delivery work lands in the linked organisation.',
    ],
    checks: [
      'Do not use the parent Partners workspace for client data unless the task is internal/platform-level.',
      'If the org scope looks wrong, switch the selected client before changing records.',
    ],
  },
  {
    title: 'Projects, Kanban, and agent tasks',
    eyebrow: 'Execution bus',
    icon: 'rocket_launch',
    summary: 'Projects and task boards are the durable handoff layer for specs, approvals, specialist execution, blockers, evidence, and review.',
    href: '/admin/projects',
    hrefLabel: 'Open Projects',
    steps: [
      'Create or open the owning project before assigning specialist work.',
      'Put enough context in the task description for the assignee to act without rereading the whole conversation.',
      'Use review/status fields and comments to request changes instead of starting duplicate work.',
    ],
    checks: [
      'Future or approval-gated agent tasks must stay awaiting input until approval is recorded.',
      'Archive only after project-level closeout evidence is recorded.',
    ],
  },
  {
    title: 'Documents and approvals',
    eyebrow: 'Specs and client-facing output',
    icon: 'description',
    summary: 'Documents are the polish and approval surface for specs, reports, revisions, handover packs, and other structured outputs.',
    href: '/admin/documents',
    hrefLabel: 'Open Documents',
    steps: [
      'Draft the spec or output as a document when it needs review, approval, or client-facing polish.',
      'Link the document back to the project, task, client, or source research item.',
      'Use document status and comments to keep approval history visible.',
    ],
    checks: [
      'Do not publish or send client-visible documents without the approval gate.',
      'Use Archive/history for old material instead of cluttering active document lists.',
    ],
  },
  {
    title: 'Research and intelligence',
    eyebrow: 'Evidence layer',
    icon: 'travel_explore',
    summary: 'Research pages collect source-backed intelligence and can be promoted into documents or tasks when the recommendation is ready to execute.',
    href: '/admin/research',
    hrefLabel: 'Open Research',
    steps: [
      'Use research items for raw findings, citations, competitor notes, and strategic recommendations.',
      'Attach research to the relevant client, project, campaign, or document.',
      'Convert only the useful synthesis into client-facing documents or implementation tasks.',
    ],
    checks: [
      'Evidence should change the recommendation; if it does not, record why.',
      'Separate strategy recommendations from execution approval.',
    ],
  },
  {
    title: 'Marketing, SEO, and social',
    eyebrow: 'Growth execution',
    icon: 'campaign',
    summary: 'Marketing is grouped into content, campaigns, social, email, SEO, and capture-source surfaces so operators can move from plan to queue to performance.',
    href: '/admin/marketing',
    hrefLabel: 'Open Marketing',
    steps: [
      'Use the Marketing hub to choose the right channel surface.',
      'For client work, prefer the client workspace marketing pages so org scope is explicit.',
      'Review preview cards, queues, and analytics before asking for publishing or spend approval.',
    ],
    checks: [
      'Public publishing and paid spend require explicit approval.',
      'SEO sprint work should update the SEO sprint record as well as the project task.',
    ],
  },
  {
    title: 'Agents, skills, and automation',
    eyebrow: 'Specialist operations',
    icon: 'group_work',
    summary: 'Agent admin pages expose specialist status, tasks, skills, policy, logs, files, cron jobs, and Hermes profile controls for platform operators.',
    href: '/admin/agents',
    hrefLabel: 'Open Agents',
    steps: [
      'Check agent health before assigning urgent work to a specialist.',
      'Use task-board handoffs for durable work; use chat for short coordination.',
      'Inspect logs/runs when an agent task stalls, blocks, or returns incomplete evidence.',
    ],
    checks: [
      'Skill policy or config changes are sensitive and should be previewed before apply.',
      'Do not treat an agent done status as proof; open the output artifacts and evidence.',
    ],
  },
  {
    title: 'Settings, users, and access',
    eyebrow: 'Governance',
    icon: 'settings',
    summary: 'Settings now groups platform configuration, staff access, platform members, notification preferences, API keys, and workspace-level settings.',
    href: '/admin/settings',
    hrefLabel: 'Open Settings',
    steps: [
      'Use platform users for internal staff/operator access.',
      'Use platform members or client team pages for client portal users.',
      'Review allowed organisations before assuming an admin should see every client.',
    ],
    checks: [
      'Secrets, API keys, profile config, and permission changes require careful approval and audit evidence.',
      'Do not use allowedOrgIds as a replacement for client organisation membership.',
    ],
  },
]

const RELEASE_NOTES = [
  'Use this page as the admin orientation map for recent platform changes and where operators should work next.',
  'Each card links to the live admin surface and lists the practical operating steps plus the approval or evidence checks that still apply.',
  'This is an internal admin page; it does not send messages, publish content, spend budget, deploy code, or change client records by itself.',
]

export default function AdminUpdatesPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="pib-card border-[var(--color-pib-accent)]/35 bg-[var(--color-pib-accent-soft)]/10 p-6 md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow">Admin updates</p>
            <h1 className="pib-page-title mt-2">What changed and where to go</h1>
            <p className="pib-page-sub mt-3">
              A detailed admin guide to the updated Partners in Biz operating surfaces: what each area is for, where to open it, and what to do when you get there.
            </p>
          </div>
          <Link href="/admin/dashboard" className="btn-pib-accent self-start lg:self-auto">
            <span className="material-symbols-outlined text-base" aria-hidden="true">space_dashboard</span>
            Start at dashboard
          </Link>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3" aria-label="How to use this updates page">
        {RELEASE_NOTES.map((note) => (
          <div key={note} className="pib-card p-4">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">info</span>
              <p className="text-sm leading-6 text-[var(--color-pib-text-muted)]">{note}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4" aria-label="Updated admin areas">
        <div>
          <p className="eyebrow">Updated areas</p>
          <h2 className="mt-1 text-2xl font-display text-[var(--color-pib-text)]">Admin operating map</h2>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {ADMIN_UPDATE_AREAS.map((area) => (
            <article key={area.title} className="pib-card p-5 md:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                    <span className="material-symbols-outlined text-[23px]" aria-hidden="true">{area.icon}</span>
                  </span>
                  <div>
                    <p className="eyebrow !text-[10px]">{area.eyebrow}</p>
                    <h3 className="mt-1 text-lg font-display text-[var(--color-pib-text)]">{area.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{area.summary}</p>
                  </div>
                </div>
                <Link href={area.href} className="btn-pib-secondary shrink-0 self-start">
                  {area.hrefLabel}
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_forward</span>
                </Link>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
                  <h4 className="text-sm font-label font-semibold uppercase tracking-widest text-[var(--color-pib-text)]">What to do</h4>
                  <ol className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                    {area.steps.map((step) => (
                      <li key={step} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-pib-accent)]" aria-hidden="true" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-2xl border border-amber-300/25 bg-amber-500/5 p-4">
                  <h4 className="text-sm font-label font-semibold uppercase tracking-widest text-amber-100">Checks and gates</h4>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-100/85">
                    {area.checks.map((check) => (
                      <li key={check} className="flex gap-2">
                        <span className="material-symbols-outlined mt-0.5 text-[16px] text-amber-200" aria-hidden="true">verified</span>
                        <span>{check}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
