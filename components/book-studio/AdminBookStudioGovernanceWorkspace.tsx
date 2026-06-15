'use client'

import { useMemo, useState } from 'react'
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

interface AdminBookStudioGovernanceWorkspaceProps {
  orgSlug: string
}

export function AdminBookStudioGovernanceWorkspace({ orgSlug }: AdminBookStudioGovernanceWorkspaceProps) {
  const policyControls = useOrganizationModulePolicy({ orgSlug, moduleKey: 'bookStudio' })
  const [newTemplateName, setNewTemplateName] = useState('')
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
            <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
            Open project gates
          </Link>
        )}
      />

      <Surface className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow !text-[10px]">Book Studio access</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Who can use Book Studio</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Every action exposes the same role choices so each organisation can choose its own Book Studio rules.
            </p>
          </div>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-card-border)] text-[var(--color-pib-accent)]">
            <span className="material-symbols-outlined text-[20px] leading-none">auto_stories</span>
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
            <p className="eyebrow !text-[10px]">Book templates</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Default Book Studio templates plus organisation custom templates</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Keep standard book, lead magnet, case study, playbook, and publishing packet workflows available by default. Add organisation-specific templates here.
            </p>
          </div>
          <div className="flex w-full gap-2 md:w-auto">
            <input
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              placeholder="Custom template"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface"
            />
            <button type="button" onClick={addTemplate} className="pib-btn-secondary shrink-0">
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-on-surface">{template.label}</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">{template.description}</p>
                </div>
                <span className="rounded-full border border-[var(--color-card-border)] px-2 py-1 text-[10px] uppercase tracking-wide text-on-surface-variant">
                  {template.locked ? 'Default' : 'Custom'}
                </span>
              </div>
              <button
                type="button"
                disabled={template.locked}
                onClick={() => removeTemplate(template.id)}
                className="mt-4 inline-flex items-center gap-1 text-xs text-on-surface-variant transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="material-symbols-outlined text-[15px]">delete</span>
                {template.locked ? 'Default cannot be deleted yet' : 'Delete custom template'}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-on-surface-variant">{customTemplateCount} custom Book Studio templates configured for this organisation.</p>
      </Surface>

      <Surface className="p-5">
        <p className="eyebrow !text-[10px]">Book-owner settings</p>
        <h2 className="mt-2 text-lg font-semibold text-on-surface">What book owners control inside a book project</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
          These project-level permissions belong inside each Book Studio project settings flow, separate from the admin module rules.
        </p>
        <OrganizationOwnerControlsGrid
          rows={ownerRows}
          policy={policyControls.policy}
          disabled={policyControls.loading || policyControls.saving}
          onControlChange={policyControls.setOwnerControl}
        />
      </Surface>
    </div>
  )
}
