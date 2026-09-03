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

import { Icon } from '@/components/studio'

type MobileAppTemplate = {
  id: string
  label: string
  description: string
  locked?: boolean
}

const DEFAULT_MOBILE_APP_TEMPLATES: MobileAppTemplate[] = [
  { id: 'ios', label: 'iOS app', description: 'App Store listing, bundle ID, screenshots, privacy, and release notes.', locked: true },
  { id: 'android', label: 'Android app', description: 'Google Play listing, package name, screenshots, privacy, and release notes.', locked: true },
  { id: 'pwa', label: 'PWA', description: 'Installable web app, manifest, icon set, and offline/update policy.', locked: true },
  { id: 'internal', label: 'Internal app', description: 'Private distribution, access notes, users, and support ownership.', locked: true },
  { id: 'aso', label: 'ASO refresh', description: 'Listing copy, keywords, screenshots, rating notes, and growth tests.', locked: true },
]

const MOBILE_APP_PERMISSION_ROWS: OrganizationPolicyActionRow[] = [
  { id: 'visibility', title: 'Mobile Apps tab visibility', description: 'Choose which organisation roles can see Mobile Apps in the client portal.' },
  { id: 'create', title: 'Create app profiles', description: 'Choose who can create app inventory, store listing, or release records.' },
  { id: 'edit', title: 'Edit app profiles', description: 'Choose who can update app metadata, ASO notes, assets, and release details.' },
  { id: 'storeLinks', title: 'Manage store links and identifiers', description: 'Choose who can edit App Store, Play Store, bundle, package, and support links.' },
  { id: 'analytics', title: 'Update analytics snapshots', description: 'Choose who can update installs, active users, ratings, reviews, and performance notes.' },
  { id: 'portalExposure', title: 'Expose apps in the client portal', description: 'Choose who can approve which apps and notes are visible to the client portal.' },
  { id: 'archiveDelete', title: 'Archive or delete app profiles', description: 'Choose who can perform destructive mobile app actions when delegated.' },
]

const APP_OWNER_ROWS = [
  'Invite reviewers',
  'Edit ASO copy',
  'Manage screenshots',
  'Update release notes',
  'Manage portal notes',
  'Link docs and projects',
]

interface AdminMobileAppsGovernanceWorkspaceProps {
  orgSlug: string
}

export function AdminMobileAppsGovernanceWorkspace({ orgSlug }: AdminMobileAppsGovernanceWorkspaceProps) {
  const policyControls = useOrganizationModulePolicy({ orgSlug, moduleKey: 'mobileApps' })
  const [newTemplateName, setNewTemplateName] = useState('')
  const ownerRows = useMemo(() => ownerControlRows(APP_OWNER_ROWS), [])
  const templates = useMemo<MobileAppTemplate[]>(
    () => [
      ...DEFAULT_MOBILE_APP_TEMPLATES,
      ...policyControls.policy.customItems.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description || 'Custom organisation mobile app template.',
      })),
    ],
    [policyControls.policy.customItems],
  )
  const customTemplateCount = useMemo(() => templates.filter((template) => !template.locked).length, [templates])

  function addTemplate() {
    const label = newTemplateName.trim()
    if (!label) return
    const baseId = policyItemIdFromLabel(label, 'mobile-app')
    const id = templates.some((template) => template.id === baseId) ? `${baseId}-${Date.now()}` : baseId
    policyControls.addCustomItem({ id, label, description: 'Custom organisation mobile app template.' })
    setNewTemplateName('')
  }

  function removeTemplate(id: string) {
    policyControls.removeCustomItem(id)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace / Mobile Apps"
        title="Mobile Apps governance"
        description="Configure how this organisation manages app profiles, store listing data, release notes, analytics snapshots, and portal exposure."
        actions={(
          <Link href={`/admin/org/${encodeURIComponent(orgSlug)}/projects`} className="pib-btn-secondary">
            <Icon name="rocket_launch" className="text-[18px]" />
            Open project gates
          </Link>
        )}
      />

      <Surface className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow !text-[10px]">Mobile app access</p>
            <h2 className="mt-2 text-lg font-medium text-[var(--color-pib-text)]">Who can use Mobile Apps</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
              Every action exposes the same role choices so each organisation can choose its own mobile app rules.
            </p>
          </div>
          <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Icon name="smartphone" className="text-[20px] leading-none" />
          </span>
        </div>

        <OrganizationModulePolicyRoleGrid
          rows={MOBILE_APP_PERMISSION_ROWS}
          policy={policyControls.policy}
          testIdPrefix="mobile-app-permission"
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
            <p className="eyebrow !text-[10px]">App profile templates</p>
            <h2 className="mt-2 text-lg font-medium text-[var(--color-pib-text)]">Default mobile app templates plus organisation custom templates</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
              Keep standard iOS, Android, PWA, internal app, and ASO workflows available by default. Add organisation-specific mobile app templates here.
            </p>
          </div>
          <div className="flex w-full gap-2 md:w-auto">
            <input aria-label="Custom template"
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              placeholder="Custom template"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-pib-text)]"
            />
            <button type="button" onClick={addTemplate} className="pib-btn-secondary shrink-0">
              <Icon name="add" className="text-[18px]" />
              Add
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-pib-text)]">{template.label}</h3>
                  <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{template.description}</p>
                </div>
                <span className="pib-pill pib-pill-cyan !text-[10px] normal-case">
                  {template.locked ? 'Default' : 'Custom'}
                </span>
              </div>
              <button
                type="button"
                disabled={template.locked}
                onClick={() => removeTemplate(template.id)}
                className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Icon name="delete" className="text-[15px]" />
                {template.locked ? 'Default cannot be deleted yet' : 'Delete custom template'}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-[var(--color-pib-text-muted)]">{customTemplateCount} custom mobile app templates configured for this organisation.</p>
      </Surface>

      <Surface className="p-5">
        <p className="eyebrow !text-[10px]">App-owner settings</p>
        <h2 className="mt-2 text-lg font-medium text-[var(--color-pib-text)]">What app owners control inside an app profile</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
          These app-level permissions belong inside each mobile app settings flow, separate from the admin module rules.
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
