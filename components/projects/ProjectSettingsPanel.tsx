'use client'

import type { ReactNode } from 'react'

function parseIdList(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)))
}

function idListValue(values: string[]): string {
  return values.join('\n')
}

interface ProjectSettingsPanelProps {
  name: string
  status: string
  surfaceMode: string
  description: string
  saving: boolean
  saved: boolean
  onNameChange: (value: string) => void
  onStatusChange: (value: string) => void
  onSurfaceModeChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  sourceCompanyId: string
  additionalCompanyIds: string[]
  sourceContactId: string
  additionalContactIds: string[]
  onSourceCompanyIdChange: (value: string) => void
  onAdditionalCompanyIdsChange: (value: string[]) => void
  onSourceContactIdChange: (value: string) => void
  onAdditionalContactIdsChange: (value: string[]) => void
  onSave: () => void
  peopleAccessSlot?: ReactNode
  adminTransferSlot?: ReactNode
}

export function ProjectSettingsPanel({
  name,
  status,
  surfaceMode,
  description,
  saving,
  saved,
  onNameChange,
  onStatusChange,
  onSurfaceModeChange,
  onDescriptionChange,
  sourceCompanyId,
  additionalCompanyIds,
  sourceContactId,
  additionalContactIds,
  onSourceCompanyIdChange,
  onAdditionalCompanyIdsChange,
  onSourceContactIdChange,
  onAdditionalContactIdsChange,
  onSave,
  peopleAccessSlot,
  adminTransferSlot,
}: ProjectSettingsPanelProps) {
  return (
    <div className="flex-1 overflow-auto pb-6">
      <div className="max-w-4xl space-y-6">
        <div className="pib-card rounded-[var(--radius-card)] p-5">
          <p className="pib-label">Project settings</p>
          <h2 className="mt-1 text-2xl font-headline font-medium text-[var(--color-pib-text)]">Manage this board</h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">Update the client-facing project details while keeping the same polished board styling.</p>
        </div>
        <div className="pib-card p-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="project-settings-name" className="pib-label">Project Name</label>
              <input
                id="project-settings-name"
                type="text"
                value={name}
                onChange={e => onNameChange(e.target.value)}
                className="pib-input w-full"
              />
            </div>
            <div>
              <label htmlFor="project-settings-status" className="pib-label">Status</label>
              <select
                id="project-settings-status"
                value={status}
                onChange={e => onStatusChange(e.target.value)}
                className="pib-select w-full"
              >
                <option value="discovery">Discovery</option>
                <option value="design">Design</option>
                <option value="development">Development</option>
                <option value="review">Review</option>
                <option value="live">Live</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <div>
              <label htmlFor="project-settings-surface-mode" className="pib-label">Surface mode</label>
              <select
                id="project-settings-surface-mode"
                value={surfaceMode}
                onChange={e => onSurfaceModeChange(e.target.value)}
                className="pib-select w-full"
              >
                <option value="">Not set (agent chooses)</option>
                <option value="persuade">Persuade - landing/sales page</option>
                <option value="operate">Operate - dashboard/app</option>
                <option value="read">Read - docs/knowledge</option>
                <option value="experience">Experience - portfolio/showcase</option>
              </select>
              <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                Tells agents which design standard applies to this web surface (Impeccable-style).
              </p>
            </div>
            <div className="pib-surface p-4">
              <p className="pib-label">Current board</p>
              <p className="mt-2 text-lg font-headline font-medium text-[var(--color-pib-text)]">{name || 'Untitled project'}</p>
              <p className="mt-1 text-sm capitalize text-[var(--color-pib-text-muted)]">{status.replace(/_/g, ' ')}</p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="project-settings-description" className="pib-label">Description</label>
              <textarea
                id="project-settings-description"
                value={description}
                onChange={e => onDescriptionChange(e.target.value)}
                className="pib-textarea w-full"
                rows={5}
              />
            </div>
            <div className="md:col-span-2 pib-surface p-4">
              <div className="mb-4">
                <p className="pib-label">CRM relationships</p>
                <h3 className="mt-1 text-lg font-headline font-medium text-[var(--color-pib-text)]">Linked companies and contacts</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  Edit the project-side CRM links used by company/contact Projects panels. Claim/share invites stay tied to the explicit primary company/contact; additional links do not create extra invite or claim-token targets.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="project-settings-source-company" className="pib-label">Primary company</label>
                  <input
                    id="project-settings-source-company"
                    type="text"
                    value={sourceCompanyId}
                    onChange={e => onSourceCompanyIdChange(e.target.value)}
                    placeholder="sourceCompanyId or companyId"
                    className="pib-input w-full font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="project-settings-source-contact" className="pib-label">Primary contact</label>
                  <input
                    id="project-settings-source-contact"
                    type="text"
                    value={sourceContactId}
                    onChange={e => onSourceContactIdChange(e.target.value)}
                    placeholder="sourceContactId or contactId"
                    className="pib-input w-full font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="project-settings-company-ids" className="pib-label">Additional company links</label>
                  <textarea
                    id="project-settings-company-ids"
                    value={idListValue(additionalCompanyIds)}
                    onChange={e => onAdditionalCompanyIdsChange(parseIdList(e.target.value))}
                    placeholder="One company id per line"
                    rows={4}
                    className="pib-textarea w-full font-mono"
                  />
                  <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">Saved to companyIds for reverse CRM visibility.</p>
                </div>
                <div>
                  <label htmlFor="project-settings-contact-ids" className="pib-label">Additional contact links</label>
                  <textarea
                    id="project-settings-contact-ids"
                    value={idListValue(additionalContactIds)}
                    onChange={e => onAdditionalContactIdsChange(parseIdList(e.target.value))}
                    placeholder="One contact id per line"
                    rows={4}
                    className="pib-textarea w-full font-mono"
                  />
                  <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">Saved to contactIds for reverse CRM visibility.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-3 border-t border-[var(--color-pib-line)] pt-5">
            <button
              onClick={onSave}
              disabled={saving || !name.trim()}
              className="pib-btn-primary text-sm font-label"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            {saved && (
              <span className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs text-green-300">Saved</span>
            )}
          </div>
        </div>
        {peopleAccessSlot}
        {adminTransferSlot}
      </div>
    </div>
  )
}
