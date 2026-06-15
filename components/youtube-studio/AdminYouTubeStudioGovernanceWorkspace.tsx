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

type YouTubeTemplate = {
  id: string
  label: string
  description: string
  locked?: boolean
}

const DEFAULT_YOUTUBE_TEMPLATES: YouTubeTemplate[] = [
  { id: 'channel', label: 'Channel workspace', description: 'Channel positioning, access, defaults, publishing settings, and ownership.', locked: true },
  { id: 'series', label: 'Series plan', description: 'Recurring format, audience, cadence, episode rules, and approval flow.', locked: true },
  { id: 'video', label: 'Video project', description: 'Brief, script, assets, render, metadata, thumbnail, and review gates.', locked: true },
  { id: 'shorts', label: 'Shorts package', description: 'Clip candidates, captions, variants, and repurposing workflow.', locked: true },
  { id: 'publish', label: 'Publishing packet', description: 'Metadata, files, checks, schedule, visibility, and evidence package.', locked: true },
]

const YOUTUBE_PERMISSION_ROWS: OrganizationPolicyActionRow[] = [
  { id: 'visibility', title: 'YouTube Studio tab visibility', description: 'Choose which organisation roles can see YouTube Studio in the client portal.' },
  { id: 'create', title: 'Create channel workspaces', description: 'Choose who can create channel records, series plans, and video projects.' },
  { id: 'edit', title: 'Edit production work', description: 'Choose who can edit briefs, scripts, assets, metadata, thumbnails, and release notes.' },
  { id: 'sourceAssets', title: 'Manage source assets', description: 'Choose who can attach source files, evidence, references, and rights notes.' },
  { id: 'productionJobs', title: 'Queue production jobs', description: 'Choose who can request agent jobs, clip generation, render work, and production drafts.' },
  { id: 'publishApprovals', title: 'Request publish approvals', description: 'Choose who can move videos or packets into review, approval, and schedule gates.' },
  { id: 'portalExposure', title: 'Expose YouTube work in the client portal', description: 'Choose who can approve channel, video, packet, and analytics visibility.' },
  { id: 'archiveDelete', title: 'Archive or delete YouTube work', description: 'Choose who can perform destructive YouTube Studio actions when delegated.' },
]

const YOUTUBE_OWNER_ROWS = [
  'Invite reviewers',
  'Edit scripts',
  'Manage assets',
  'Approve metadata',
  'Manage publish packets',
  'Link docs and projects',
]

interface AdminYouTubeStudioGovernanceWorkspaceProps {
  orgSlug: string
}

export function AdminYouTubeStudioGovernanceWorkspace({ orgSlug }: AdminYouTubeStudioGovernanceWorkspaceProps) {
  const policyControls = useOrganizationModulePolicy({ orgSlug, moduleKey: 'youtubeStudio' })
  const [newTemplateName, setNewTemplateName] = useState('')
  const ownerRows = useMemo(() => ownerControlRows(YOUTUBE_OWNER_ROWS), [])
  const templates = useMemo<YouTubeTemplate[]>(
    () => [
      ...DEFAULT_YOUTUBE_TEMPLATES,
      ...policyControls.policy.customItems.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description || 'Custom organisation YouTube Studio template.',
      })),
    ],
    [policyControls.policy.customItems],
  )
  const customTemplateCount = useMemo(() => templates.filter((template) => !template.locked).length, [templates])

  function addTemplate() {
    const label = newTemplateName.trim()
    if (!label) return
    const baseId = policyItemIdFromLabel(label, 'youtube-studio')
    const id = templates.some((template) => template.id === baseId) ? `${baseId}-${Date.now()}` : baseId
    policyControls.addCustomItem({ id, label, description: 'Custom organisation YouTube Studio template.' })
    setNewTemplateName('')
  }

  function removeTemplate(id: string) {
    policyControls.removeCustomItem(id)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace / YouTube Studio"
        title="YouTube Studio governance"
        description="Configure how this organisation manages channels, video production, source assets, publishing packets, approval gates, and portal exposure."
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
            <p className="eyebrow !text-[10px]">YouTube Studio access</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Who can use YouTube Studio</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Every action exposes the same role choices so each organisation can choose its own YouTube Studio rules.
            </p>
          </div>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-card-border)] text-[var(--color-pib-accent)]">
            <span className="material-symbols-outlined text-[20px] leading-none">smart_display</span>
          </span>
        </div>

        <OrganizationModulePolicyRoleGrid
          rows={YOUTUBE_PERMISSION_ROWS}
          policy={policyControls.policy}
          testIdPrefix="youtube-studio-permission"
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
            <p className="eyebrow !text-[10px]">Production templates</p>
            <h2 className="mt-2 text-lg font-semibold text-on-surface">Default YouTube Studio templates plus organisation custom templates</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Keep standard channel, series, video, shorts, and publishing workflows available by default. Add organisation-specific YouTube templates here.
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

        <p className="mt-4 text-xs text-on-surface-variant">{customTemplateCount} custom YouTube Studio templates configured for this organisation.</p>
      </Surface>

      <Surface className="p-5">
        <p className="eyebrow !text-[10px]">Video-owner settings</p>
        <h2 className="mt-2 text-lg font-semibold text-on-surface">What owners control inside a channel or video project</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
          These project-level permissions belong inside each YouTube channel or video settings flow, separate from the admin module rules.
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
