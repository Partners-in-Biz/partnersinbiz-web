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

type DocumentTemplate = {
  id: string
  label: string
  description: string
  locked?: boolean
}

const DEFAULT_DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  { id: 'proposal', label: 'Proposal', description: 'Commercial proposal, scope, pricing, and acceptance terms.', locked: true },
  { id: 'brief', label: 'Brief', description: 'Project brief, assumptions, objectives, and constraints.', locked: true },
  { id: 'spec', label: 'Build spec', description: 'Implementation requirements, architecture, and acceptance criteria.', locked: true },
  { id: 'report', label: 'Report', description: 'Performance, research, campaign, or delivery reports.', locked: true },
  { id: 'contract', label: 'Agreement', description: 'Terms, service agreements, and approval records.', locked: true },
]

const DOCUMENT_PERMISSION_ROWS: OrganizationPolicyActionRow[] = [
  { id: 'visibility', title: 'Documents tab visibility', description: 'Choose which organisation roles can see the Documents module.' },
  { id: 'create', title: 'Create new documents', description: 'Choose who can create document drafts or request new deliverables.' },
  { id: 'edit', title: 'Edit document drafts', description: 'Choose who can edit internal or shared document drafts.' },
  { id: 'reviewApproval', title: 'Send for review or approval', description: 'Choose who can move documents into client review and approval states.' },
  { id: 'shareLinks', title: 'Create share links', description: 'Choose who can create or revoke external document share links.' },
  { id: 'archiveDelete', title: 'Archive or delete documents', description: 'Choose who can perform destructive document actions when delegated.' },
]

const DOCUMENT_OWNER_ROWS = [
  'Invite reviewers',
  'Resolve comments',
  'Approve final versions',
  'Link docs to projects',
  'Manage share settings',
]

interface AdminDocumentsGovernanceWorkspaceProps {
  orgSlug: string
}

export function AdminDocumentsGovernanceWorkspace({ orgSlug }: AdminDocumentsGovernanceWorkspaceProps) {
  const policyControls = useOrganizationModulePolicy({ orgSlug, moduleKey: 'documents' })
  const [newTemplateName, setNewTemplateName] = useState('')
  const ownerRows = useMemo(() => ownerControlRows(DOCUMENT_OWNER_ROWS), [])
  const templates = useMemo<DocumentTemplate[]>(
    () => [
      ...DEFAULT_DOCUMENT_TEMPLATES,
      ...policyControls.policy.customItems.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description || 'Custom organisation document template.',
      })),
    ],
    [policyControls.policy.customItems],
  )
  const customTemplateCount = useMemo(() => templates.filter((template) => !template.locked).length, [templates])

  function addTemplate() {
    const label = newTemplateName.trim()
    if (!label) return
    const baseId = policyItemIdFromLabel(label, 'template')
    const id = templates.some((template) => template.id === baseId) ? `${baseId}-${Date.now()}` : baseId
    policyControls.addCustomItem({ id, label, description: 'Custom organisation document template.' })
    setNewTemplateName('')
  }

  function removeTemplate(id: string) {
    policyControls.removeCustomItem(id)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace / Documents"
        title="Document governance"
        description="Configure how this organisation creates, reviews, shares, and deletes documents. The client portal should show approved work; admins control document rules here."
        actions={(
          <Link href={`/admin/org/${encodeURIComponent(orgSlug)}/documents/new`} className="pib-btn-secondary">
            <span className="material-symbols-outlined text-[18px]">note_add</span>
            New internal draft
          </Link>
        )}
      />

      <Surface className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow !text-[10px]">Document access</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Who can use documents</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Every action exposes the same role choices so each organisation can choose its own access rules.
            </p>
          </div>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-card-border)] text-[var(--color-pib-accent)]">
            <span className="material-symbols-outlined text-[20px] leading-none">description</span>
          </span>
        </div>

        <OrganizationModulePolicyRoleGrid
          rows={DOCUMENT_PERMISSION_ROWS}
          policy={policyControls.policy}
          testIdPrefix="document-permission"
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
            <p className="eyebrow !text-[10px]">Document templates</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Default templates plus organisation custom templates</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Keep standard proposals, briefs, specs, reports, and agreements available by default. Add organisation-specific document templates here.
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

        <p className="mt-4 text-xs text-on-surface-variant">{customTemplateCount} custom document templates configured for this organisation.</p>
      </Surface>

      <Surface className="p-5">
        <p className="eyebrow !text-[10px]">Document-owner settings</p>
        <h2 className="mt-2 text-lg font-semibold text-on-surface">What document owners control inside a document</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
          These document-level permissions belong inside each document settings flow, separate from the portal document list.
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
