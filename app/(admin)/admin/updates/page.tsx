import Link from 'next/link'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

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

type FutureUpdateCouncilStandard = {
  title: string
  summary: string
  criteria: string[]
  entryFields: string[]
  councilChecks: string[]
}

const ADMIN_UPDATE_AREAS: UpdateArea[] = [
  {
    title: 'Mission Control and briefings',
    eyebrow: 'Daily command desk',
    icon: 'team_dashboard',
    summary: 'A single place to see urgent cards, route decisions, open evidence, assign agents, and turn platform signals into follow-up work.',
    href: '/admin/dashboard',
    hrefLabel: 'Open Dashboard',
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
    summary: 'The dashboard now acts as the top-level operating map for organisations, live work, platform health, approvals, and recent activity.',
    href: '/admin/dashboard',
    hrefLabel: 'Open Dashboard',
    steps: [
      'Use the organisation cards to jump into the selected admin command surface.',
      'Use the work lanes to find pending, active, blocked, review, and completed agent work.',
      'Use activity and health panels as a quick proof check before chasing an issue elsewhere.',
    ],
    checks: [
      'If an organisation does not appear, check Organisations before assuming the command surface is gone.',
      'Dashboard signals are navigational; action still happens in the linked task, org, or module page.',
    ],
  },
  {
    title: 'Organisation admin command pages',
    eyebrow: 'Organisation-scoped operations',
    icon: 'business_center',
    summary: 'Each selected organisation has clearer admin routes for overview, projects, documents, research, marketing, messages, reports, team, billing, and settings.',
    href: '/admin/organizations',
    hrefLabel: 'Choose Organisation',
    steps: [
      'Open Organisations, choose the target organisation, then use the left navigation inside that admin command surface.',
      'Keep organisation-scoped work inside the selected admin org surface instead of using top-level platform pages by habit.',
      'For linked CRM company work, follow the banner/source context so delivery work lands in the linked organisation.',
    ],
    checks: [
      'Do not use the parent Partners workspace for tenant organisation data unless the task is internal/platform-level.',
      'If the org scope looks wrong, switch the selected organisation before changing records.',
    ],
  },
  {
    title: 'Projects, Kanban, and agent tasks',
    eyebrow: 'Execution bus',
    icon: 'rocket_launch',
    summary: 'Projects and task boards are the durable handoff layer for specs, approvals, specialist execution, blockers, evidence, and review.',
    href: '/admin/organizations',
    hrefLabel: 'Choose Workspace',
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
    href: '/admin/organizations',
    hrefLabel: 'Choose Workspace',
    steps: [
      'Draft the spec or output as a document when it needs review, approval, or client-facing polish.',
      'Link the document back to the project, task, organisation, or source research item.',
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
    href: '/admin/organizations',
    hrefLabel: 'Choose Workspace',
    steps: [
      'Use research items for raw findings, citations, competitor notes, and strategic recommendations.',
      'Attach research to the relevant organisation, project, campaign, or document.',
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
    href: '/admin/organizations',
    hrefLabel: 'Choose Workspace',
    steps: [
      'Use the Marketing hub to choose the right channel surface.',
      'For organisation-scoped work, prefer the selected admin org marketing pages so org scope is explicit.',
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
      'Use platform members or organisation team pages for portal-access users.',
      'Review allowed organisations before assuming an admin should see every organisation.',
    ],
    checks: [
      'Secrets, API keys, profile config, and permission changes require careful approval and audit evidence.',
      'Do not use allowedOrgIds as a replacement for portal organisation membership.',
    ],
  },
]

const RELEASE_NOTES = [
  'Use this page as the admin orientation map for recent platform changes and where operators should work next.',
  'Each card links to the live admin surface and lists the practical operating steps plus the approval or evidence checks that still apply.',
  'This is an internal admin page; it does not send messages, publish content, spend budget, deploy code, or change client records by itself.',
]

const FUTURE_UPDATE_COUNCIL_STANDARD: FutureUpdateCouncilStandard = {
  title: 'Future updates council standard',
  summary: 'Future entries on this page should be added when the council view is that a platform change materially affects operator workflow, client delivery, evidence standards, approvals, or strategic risk.',
  criteria: [
    'Add the update when it changes where admins should go, how work should be routed, what evidence should be checked, or which approval gate applies.',
    'Skip routine technical changes that do not change operator behaviour; keep those in commits, tasks, or release notes instead.',
    'Prefer the synthesized council recommendation over separate long agent monologues, but preserve meaningful objections and risks.',
  ],
  entryFields: [
    'Surface changed: the admin area, admin org surface, project board, agent workflow, or governance path affected.',
    'Why it matters: the operator/client-delivery impact and what decision quality improves.',
    'What to do now: the concrete next behaviour, route, task, approval, or evidence check.',
    'Council view: relevant specialist perspectives, recommendation, owner, confidence, and any minority objection.',
    'Proof: linked PR, task, spec, research item, screenshot, test result, or live route confirmation.',
  ],
  councilChecks: [
    'Future update entries are internal planning guidance, not public announcements, SEO-facing content, client commitments, or launch promises until separately approved.',
    'Client-visible sends, public publishing, paid spend, finance, secrets/config, destructive data changes, and production deploys still require their own explicit approval gate.',
  ],
}

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

      <section className="pib-card overflow-hidden border-[var(--color-pib-accent)]/25" aria-label="Future updates council standard">
        <div className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-accent-soft)]/10 p-5 md:p-6">
          <p className="eyebrow">Council standard</p>
          <h2 className="mt-1 text-2xl font-display text-[var(--color-pib-text)]">{FUTURE_UPDATE_COUNCIL_STANDARD.title}</h2>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
            {FUTURE_UPDATE_COUNCIL_STANDARD.summary}
          </p>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-3 md:p-6">
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
            <h3 className="text-sm font-label font-semibold uppercase tracking-widest text-[var(--color-pib-text)]">When to add</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              {FUTURE_UPDATE_COUNCIL_STANDARD.criteria.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="material-symbols-outlined mt-0.5 text-[16px] text-[var(--color-pib-accent)]" aria-hidden="true">rule</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
            <h3 className="text-sm font-label font-semibold uppercase tracking-widest text-[var(--color-pib-text)]">What each entry shows</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              {FUTURE_UPDATE_COUNCIL_STANDARD.entryFields.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-pib-accent)]" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-amber-300/25 bg-amber-500/5 p-4">
            <h3 className="text-sm font-label font-semibold uppercase tracking-widest text-amber-100">Boundaries</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-100/85">
              {FUTURE_UPDATE_COUNCIL_STANDARD.councilChecks.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="material-symbols-outlined mt-0.5 text-[16px] text-amber-200" aria-hidden="true">verified_user</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
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
