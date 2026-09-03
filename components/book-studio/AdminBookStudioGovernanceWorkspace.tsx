'use client'

import { Icon } from '@/components/studio'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  OrganizationModulePolicyRoleGrid,
  OrganizationModulePolicySaveBar,
  OrganizationOwnerControlsGrid,
  ownerControlRows,
  policyItemIdFromLabel,
  useOrganizationModulePolicy,
  type OrganizationPolicyActionRow,
} from '@/components/admin-governance/OrganizationModulePolicyControls'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'
import { listBookStudioRecords } from '@/lib/book-studio/client'

type BookStudioTemplate = {
  id: string
  label: string
  description: string
  locked?: boolean
}

const DEFAULT_BOOK_STUDIO_TEMPLATES: BookStudioTemplate[] = [
  { id: 'non-fiction', label: 'Non-fiction book', description: 'Long-form expertise, proof, structure, and launch packet.', locked: true },
  { id: 'lead-magnet', label: 'Lead magnet', description: 'Short-form guide, checklist, or report used for acquisition.', locked: true },
  { id: 'case-study', label: 'Case study', description: 'Client-safe narrative, proof, outcomes, and approval trail.', locked: true },
  { id: 'playbook', label: 'Playbook', description: 'Repeatable process, operating model, or implementation guide.', locked: true },
  { id: 'publishing-packet', label: 'Publishing packet', description: 'Metadata, files, evidence, rights, and release checklist.', locked: true },
]

const BOOK_STUDIO_PERMISSION_ROWS: OrganizationPolicyActionRow[] = [
  { id: 'visibility', title: 'Book Studio tab visibility', description: 'Choose which organisation roles can see Book Studio in the client portal.' },
  { id: 'create', title: 'Create book projects', description: 'Choose who can request or create new Book Studio work.' },
  { id: 'edit', title: 'Edit briefs and manuscripts', description: 'Choose who can update briefs, drafts, metadata, and production notes.' },
  { id: 'evidenceRights', title: 'Add evidence and rights sources', description: 'Choose who can attach provenance, rights records, and supporting proof.' },
  { id: 'approvalGates', title: 'Request approval gates', description: 'Choose who can move book work into review, approval, or release gates.' },
  { id: 'publishingPackets', title: 'Prepare publishing packets', description: 'Choose who can assemble package-bound files, metadata, and launch material.' },
  { id: 'archiveDelete', title: 'Archive or delete book work', description: 'Choose who can perform destructive Book Studio actions when delegated.' },
]

const BOOK_OWNER_ROWS = [
  'Invite reviewers',
  'Resolve comments',
  'Approve final briefs',
  'Manage rights evidence',
  'Link docs and projects',
  'Manage publishing packet',
]

// Mirrors lib/book-studio/lifecycle.ts's LIFECYCLE_STATES / BookLifecycleState.
// Declared locally (rather than importing from lifecycle.ts) because that
// module imports `firebase-admin/firestore` at module scope and is not
// client-bundle-safe; this file is `'use client'`.
const LIFECYCLE_PIPELINE_STATES = [
  'draft', 'content_complete', 'rights_cleared', 'assembled',
  'qa_approved', 'submission_ready', 'submitted', 'live', 'archived',
] as const

export type LifecyclePipelineProject = {
  id: string
  title?: string
  lifecycleState?: string
}

function groupProjectsByLifecycleState(
  projects: LifecyclePipelineProject[],
): Record<(typeof LIFECYCLE_PIPELINE_STATES)[number], LifecyclePipelineProject[]> {
  const grouped = Object.fromEntries(
    LIFECYCLE_PIPELINE_STATES.map((state) => [state, [] as LifecyclePipelineProject[]]),
  ) as Record<(typeof LIFECYCLE_PIPELINE_STATES)[number], LifecyclePipelineProject[]>
  projects.forEach((project) => {
    const state = LIFECYCLE_PIPELINE_STATES.includes(project.lifecycleState as (typeof LIFECYCLE_PIPELINE_STATES)[number])
      ? (project.lifecycleState as (typeof LIFECYCLE_PIPELINE_STATES)[number])
      : 'draft'
    grouped[state].push(project)
  })
  return grouped
}

function lifecycleStateLabel(state: string): string {
  return state.replace(/_/g, ' ')
}

export function LifecyclePipelineBoard({ projects }: { projects: LifecyclePipelineProject[] }) {
  const grouped = groupProjectsByLifecycleState(projects)
  return (
    <Surface className="p-4">
      <h3 className="mb-3 text-sm text-[var(--color-pib-text-secondary)]">
        Pipeline by lifecycle state
      </h3>
      <div className="grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-3 lg:grid-cols-9">
        {LIFECYCLE_PIPELINE_STATES.map((state) => (
          <div key={state} data-testid={`lifecycle-column-${state}`} className="min-w-[140px] rounded-md border border-[var(--color-pib-border)] p-2">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-pib-text-secondary)]">
              {lifecycleStateLabel(state)} ({grouped[state].length})
            </div>
            <ul className="space-y-1">
              {grouped[state].map((project) => (
                <li key={project.id} className="truncate text-sm">{project.title ?? 'Untitled book project'}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Surface>
  )
}

interface AdminBookStudioGovernanceWorkspaceProps {
  orgSlug: string
}

export function AdminBookStudioGovernanceWorkspace({ orgSlug }: AdminBookStudioGovernanceWorkspaceProps) {
  const policyControls = useOrganizationModulePolicy({ orgSlug, moduleKey: 'bookStudio' })
  const [newTemplateName, setNewTemplateName] = useState('')
  const [pipelineProjects, setPipelineProjects] = useState<LifecyclePipelineProject[]>([])
  const [pipelineLoading, setPipelineLoading] = useState(true)
  const [pipelineError, setPipelineError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadProjects() {
      if (typeof fetch !== 'function') {
        setPipelineLoading(false)
        return
      }
      setPipelineLoading(true)
      setPipelineError('')
      try {
        const orgsRes = await fetch('/api/v1/organizations')
        const orgsBody = await orgsRes.json().catch(() => ({}))
        const orgs = Array.isArray(orgsBody.data) ? orgsBody.data as { id: string; slug: string }[] : []
        const org = orgs.find((item) => item.slug === orgSlug)
        if (!org?.id) throw new Error('Organisation not found')

        const result = await listBookStudioRecords<LifecyclePipelineProject>('projects', org.id)
        if (cancelled) return
        if (!result.ok) throw new Error(result.error)
        setPipelineProjects(result.data.records)
      } catch (err) {
        if (!cancelled) {
          setPipelineError(err instanceof Error ? err.message : 'Could not load Book Studio projects')
          setPipelineProjects([])
        }
      } finally {
        if (!cancelled) setPipelineLoading(false)
      }
    }

    loadProjects()
    return () => {
      cancelled = true
    }
  }, [orgSlug])
  const ownerRows = useMemo(() => ownerControlRows(BOOK_OWNER_ROWS), [])
  const templates = useMemo<BookStudioTemplate[]>(
    () => [
      ...DEFAULT_BOOK_STUDIO_TEMPLATES,
      ...policyControls.policy.customItems.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description || 'Custom organisation Book Studio template.',
      })),
    ],
    [policyControls.policy.customItems],
  )
  const customTemplateCount = useMemo(() => templates.filter((template) => !template.locked).length, [templates])

  function addTemplate() {
    const label = newTemplateName.trim()
    if (!label) return
    const baseId = policyItemIdFromLabel(label, 'book-studio')
    const id = templates.some((template) => template.id === baseId) ? `${baseId}-${Date.now()}` : baseId
    policyControls.addCustomItem({ id, label, description: 'Custom organisation Book Studio template.' })
    setNewTemplateName('')
  }

  function removeTemplate(id: string) {
    policyControls.removeCustomItem(id)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace / Book Studio"
        title="Book Studio governance"
        description="Configure how this organisation uses Book Studio, who can create book work, who can approve release gates, and which templates are available."
        actions={(
          <Link href={`/admin/org/${encodeURIComponent(orgSlug)}/projects`} className="pib-btn-secondary">
            <Icon name="rocket_launch" />
            Open project gates
          </Link>
        )}
      />

      <Surface className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="sc-tiny !text-[10px]">Book Studio access</p>
            <h2 className="mt-2 text-lg text-[var(--color-pib-text)]">Who can use Book Studio</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
              Every action exposes the same role choices so each organisation can choose its own Book Studio rules.
            </p>
          </div>
          <span className="shrink-0" aria-hidden="true">
            <Icon name="auto_stories" />
          </span>
        </div>

        <OrganizationModulePolicyRoleGrid
          rows={BOOK_STUDIO_PERMISSION_ROWS}
          policy={policyControls.policy}
          testIdPrefix="book-studio-permission"
          disabled={policyControls.loading || policyControls.saving}
          onRoleChange={policyControls.setRole}
        />
        <OrganizationModulePolicySaveBar
          loading={policyControls.loading}
          saving={policyControls.saving}
          saveState={policyControls.saveState}
          error={policyControls.error}
          onSave={policyControls.save}
        />
      </Surface>

      <Surface className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="sc-tiny !text-[10px]">Book templates</p>
            <h2 className="mt-2 text-lg text-[var(--color-pib-text)]">Default Book Studio templates plus organisation custom templates</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
              Keep standard book, lead magnet, case study, playbook, and publishing packet workflows available by default. Add organisation-specific templates here.
            </p>
          </div>
          <div className="flex w-full gap-2 md:w-auto">
            <input
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              placeholder="Custom template"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-pib-text)]"
             aria-label="Custom template"/>
            <button type="button" onClick={addTemplate} className="pib-btn-secondary shrink-0">
              <Icon name="add" />
              Add
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm text-[var(--color-pib-text)]">{template.label}</h3>
                  <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{template.description}</p>
                </div>
                <span className="pib-pill pib-pill-rose">
                  {template.locked ? 'Default' : 'Custom'}
                </span>
              </div>
              <button
                type="button"
                disabled={template.locked}
                onClick={() => removeTemplate(template.id)}
                className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Icon name="delete" />
                {template.locked ? 'Default cannot be deleted yet' : 'Delete custom template'}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-[var(--color-pib-text-muted)]">{customTemplateCount} custom Book Studio templates configured for this organisation.</p>
      </Surface>

      <Surface className="p-5">
        <p className="sc-tiny !text-[10px]">Book-owner settings</p>
        <h2 className="mt-2 text-lg text-[var(--color-pib-text)]">What book owners control inside a book project</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
          These project-level permissions belong inside each Book Studio project settings flow, separate from the admin module rules.
        </p>
        <OrganizationOwnerControlsGrid
          rows={ownerRows}
          policy={policyControls.policy}
          disabled={policyControls.loading || policyControls.saving}
          onControlChange={policyControls.setOwnerControl}
        />
      </Surface>

      {pipelineError ? (
        <Surface className="p-4">
          <p className="text-sm text-red-300">{pipelineError}</p>
        </Surface>
      ) : null}
      {pipelineLoading ? (
        <Surface className="p-4">
          <p className="text-sm text-[var(--color-pib-text-muted)]">Loading Book Studio pipeline…</p>
        </Surface>
      ) : (
        <LifecyclePipelineBoard projects={pipelineProjects} />
      )}
    </div>
  )
}
