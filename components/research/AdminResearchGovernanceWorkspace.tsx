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

type ResearchType = {
  id: string
  label: string
  description: string
  locked?: boolean
}

const DEFAULT_RESEARCH_TYPES: ResearchType[] = [
  { id: 'market', label: 'Market research', description: 'Audience, category, channel, and opportunity research.', locked: true },
  { id: 'competitor', label: 'Competitor research', description: 'Competitor positioning, offers, evidence, and gaps.', locked: true },
  { id: 'product', label: 'Product research', description: 'Product, service, pricing, and capability research.', locked: true },
  { id: 'evidence', label: 'Evidence dossier', description: 'Source-backed findings, proof, screenshots, and references.', locked: true },
  { id: 'memo', label: 'Recommendation memo', description: 'Internal recommendations before client-visible conversion.', locked: true },
]

const RESEARCH_PERMISSION_ROWS: OrganizationPolicyActionRow[] = [
  { id: 'visibility', title: 'Research tab visibility', description: 'Choose which organisation roles can see the Research module.' },
  { id: 'create', title: 'Create research notes', description: 'Choose who can create internal research notes and evidence records.' },
  { id: 'edit', title: 'Edit research notes', description: 'Choose who can edit internal findings, summaries, and recommendations.' },
  { id: 'evidenceSources', title: 'Add evidence sources', description: 'Choose who can attach sources, screenshots, citations, and supporting proof.' },
  { id: 'convertToDocuments', title: 'Convert research to client documents', description: 'Choose who can turn internal research into document drafts.' },
  { id: 'clientVisible', title: 'Mark research client-visible', description: 'Choose who can approve research outputs for client-facing use.' },
  { id: 'archiveDelete', title: 'Archive or delete research', description: 'Choose who can perform destructive research actions when delegated.' },
]

const RESEARCH_OWNER_ROWS = [
  'Invite reviewers',
  'Resolve comments',
  'Export to knowledge base',
  'Link docs and projects',
  'Manage evidence sources',
]

interface AdminResearchGovernanceWorkspaceProps {
  orgSlug: string
}

export function AdminResearchGovernanceWorkspace({ orgSlug }: AdminResearchGovernanceWorkspaceProps) {
  const policyControls = useOrganizationModulePolicy({ orgSlug, moduleKey: 'research' })
  const [newTypeName, setNewTypeName] = useState('')
  const ownerRows = useMemo(() => ownerControlRows(RESEARCH_OWNER_ROWS), [])
  const researchTypes = useMemo<ResearchType[]>(
    () => [
      ...DEFAULT_RESEARCH_TYPES,
      ...policyControls.policy.customItems.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description || 'Custom organisation research type.',
      })),
    ],
    [policyControls.policy.customItems],
  )
  const customTypeCount = useMemo(() => researchTypes.filter((type) => !type.locked).length, [researchTypes])

  function addResearchType() {
    const label = newTypeName.trim()
    if (!label) return
    const baseId = policyItemIdFromLabel(label, 'research')
    const id = researchTypes.some((type) => type.id === baseId) ? `${baseId}-${Date.now()}` : baseId
    policyControls.addCustomItem({ id, label, description: 'Custom organisation research type.' })
    setNewTypeName('')
  }

  function removeResearchType(id: string) {
    policyControls.removeCustomItem(id)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace / Research"
        title="Research governance"
        description="Configure how this organisation collects evidence, manages internal findings, converts research into client-ready work, and controls destructive research actions."
        actions={(
          <Link href={`/admin/org/${encodeURIComponent(orgSlug)}/research/new`} className="pib-btn-secondary">
            <span className="material-symbols-outlined text-[18px]">post_add</span>
            New internal note
          </Link>
        )}
      />

      <Surface className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow !text-[10px]">Research access</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Who can use research</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Every action exposes the same role choices so each organisation can choose its own research rules.
            </p>
          </div>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-card-border)] text-[var(--color-pib-accent)]">
            <span className="material-symbols-outlined text-[20px] leading-none">manage_search</span>
          </span>
        </div>

        <OrganizationModulePolicyRoleGrid
          rows={RESEARCH_PERMISSION_ROWS}
          policy={policyControls.policy}
          testIdPrefix="research-permission"
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
            <p className="eyebrow !text-[10px]">Research types</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Default research types plus organisation custom types</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Keep standard market, competitor, product, evidence, and recommendation workflows available by default. Add organisation-specific research types here.
            </p>
          </div>
          <div className="flex w-full gap-2 md:w-auto">
            <input
              value={newTypeName}
              onChange={(event) => setNewTypeName(event.target.value)}
              placeholder="Custom research type"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface"
            />
            <button type="button" onClick={addResearchType} className="pib-btn-secondary shrink-0">
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {researchTypes.map((type) => (
            <div key={type.id} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-on-surface">{type.label}</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">{type.description}</p>
                </div>
                <span className="rounded-full border border-[var(--color-card-border)] px-2 py-1 text-[10px] uppercase tracking-wide text-on-surface-variant">
                  {type.locked ? 'Default' : 'Custom'}
                </span>
              </div>
              <button
                type="button"
                disabled={type.locked}
                onClick={() => removeResearchType(type.id)}
                className="mt-4 inline-flex items-center gap-1 text-xs text-on-surface-variant transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="material-symbols-outlined text-[15px]">delete</span>
                {type.locked ? 'Default cannot be deleted yet' : 'Delete custom type'}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-on-surface-variant">{customTypeCount} custom research types configured for this organisation.</p>
      </Surface>

      <Surface className="p-5">
        <p className="eyebrow !text-[10px]">Research-owner settings</p>
        <h2 className="mt-2 text-lg font-semibold text-on-surface">What research owners control inside a research item</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
          These research-level permissions belong inside each research item settings flow, separate from the admin module rules.
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
