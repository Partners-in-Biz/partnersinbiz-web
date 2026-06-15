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

type ProjectType = {
  id: string
  label: string
  description: string
  locked?: boolean
}

const DEFAULT_PROJECT_TYPES: ProjectType[] = [
  { id: 'discovery', label: 'Discovery', description: 'Research, requirements, scope, and approval gates.', locked: true },
  { id: 'design', label: 'Design', description: 'Brand, UX, content, and prototype work.', locked: true },
  { id: 'development', label: 'Development', description: 'Build, integration, QA, and deployment preparation.', locked: true },
  { id: 'review', label: 'Review', description: 'Client review, internal QA, and sign-off.', locked: true },
  { id: 'live', label: 'Live', description: 'Production-ready or already launched work.', locked: true },
  { id: 'maintenance', label: 'Maintenance', description: 'Support, fixes, reporting, and ongoing improvements.', locked: true },
]

const ORG_PERMISSION_ROWS: OrganizationPolicyActionRow[] = [
  {
    id: 'visibility',
    title: 'Projects tab visibility',
    description: 'Choose which client-portal roles can see the Projects module for this organisation.',
  },
  {
    id: 'create',
    title: 'Create new projects',
    description: 'Limit who can request or create projects from the client portal.',
  },
  {
    id: 'archiveDelete',
    title: 'Archive or delete projects',
    description: 'Choose which organisation roles can perform destructive project actions when delegated.',
  },
]

const PROJECT_OWNER_ROWS = [
  'Invite people to a project',
  'Create and edit tasks',
  'Move tasks across the board',
  'Update the plan and timeline',
  'Link docs and deliverables',
]

interface AdminProjectsGovernanceWorkspaceProps {
  orgSlug: string
}

export function AdminProjectsGovernanceWorkspace({ orgSlug }: AdminProjectsGovernanceWorkspaceProps) {
  const policyControls = useOrganizationModulePolicy({ orgSlug, moduleKey: 'projects' })
  const [newTypeName, setNewTypeName] = useState('')
  const adminSettingsHref = `/admin/org/${encodeURIComponent(orgSlug)}/settings`
  const ownerRows = useMemo(() => ownerControlRows(PROJECT_OWNER_ROWS), [])
  const projectTypes = useMemo<ProjectType[]>(
    () => [
      ...DEFAULT_PROJECT_TYPES,
      ...policyControls.policy.customItems.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description || 'Custom organisation project type.',
      })),
    ],
    [policyControls.policy.customItems],
  )

  const customTypeCount = useMemo(
    () => projectTypes.filter((type) => !type.locked).length,
    [projectTypes],
  )

  function addProjectType() {
    const label = newTypeName.trim()
    if (!label) return
    const baseId = policyItemIdFromLabel(label, 'type')
    const id = projectTypes.some((type) => type.id === baseId) ? `${baseId}-${Date.now()}` : baseId
    policyControls.addCustomItem({ id, label, description: 'Custom organisation project type.' })
    setNewTypeName('')
  }

  function removeProjectType(id: string) {
    policyControls.removeCustomItem(id)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace / Projects"
        title="Project governance"
        description="Configure how this organisation uses projects. Client portal users should see their work; admins control access, project types, and destructive settings here."
        actions={(
          <Link href={adminSettingsHref} className="pib-btn-secondary">
            <span className="material-symbols-outlined text-[18px]">admin_panel_settings</span>
            Org settings
          </Link>
        )}
      />

      <div className="space-y-4">
        <Surface className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow !text-[10px]">Portal access</p>
              <h2 className="mt-2 text-lg font-semibold text-on-surface">Who can use projects in the client portal</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
                These organisation-level rules decide whether the Projects tab is visible and whether people can create new project requests.
              </p>
            </div>
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-card-border)] text-[var(--color-pib-accent)]">
              <span className="material-symbols-outlined text-[20px] leading-none">shield</span>
            </span>
          </div>

          <OrganizationModulePolicyRoleGrid
            rows={ORG_PERMISSION_ROWS}
            policy={policyControls.policy}
            testIdPrefix="project-permission"
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
          <p className="eyebrow !text-[10px]">Admin-only actions</p>
          <h2 className="mt-2 text-lg font-semibold text-on-surface">Project deletion stays here</h2>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            Project deletion, archive recovery, and project-type changes belong in the admin console. Client-side project owners manage project-level access inside each project settings tab.
          </p>
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-200">
              <span className="material-symbols-outlined text-[18px]">delete</span>
              Delete project policy
            </div>
            <p className="mt-2 text-sm text-red-100/75">
              Only organisation owners and platform admins should be able to permanently delete projects from this admin surface.
            </p>
          </div>
        </Surface>
      </div>

      <Surface className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="eyebrow !text-[10px]">Project types</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Default types plus organisation custom types</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Discovery, Design, Development, Review, Live, and Maintenance are defaults. Add organisation-specific types here instead of hardcoding them into the portal browser.
            </p>
          </div>
          <div className="flex w-full gap-2 md:w-auto">
            <input
              value={newTypeName}
              onChange={(event) => setNewTypeName(event.target.value)}
              placeholder="Custom type"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface"
            />
            <button type="button" onClick={addProjectType} className="pib-btn-secondary shrink-0">
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projectTypes.map((type) => (
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
                onClick={() => removeProjectType(type.id)}
                className="mt-4 inline-flex items-center gap-1 text-xs text-on-surface-variant transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="material-symbols-outlined text-[15px]">delete</span>
                {type.locked ? 'Default cannot be deleted yet' : 'Delete custom type'}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-on-surface-variant">{customTypeCount} custom project types configured for this organisation.</p>
      </Surface>

      <Surface className="p-5">
        <p className="eyebrow !text-[10px]">Project-owner settings</p>
        <h2 className="mt-2 text-lg font-semibold text-on-surface">What each project owner controls inside a project</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
          These are project-level permissions that should live inside each project settings tab for the project owner, not on the portal project list.
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
