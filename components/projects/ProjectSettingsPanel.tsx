'use client'

import type { ReactNode } from 'react'

interface ProjectSettingsPanelProps {
  name: string
  status: string
  description: string
  saving: boolean
  saved: boolean
  onNameChange: (value: string) => void
  onStatusChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onSave: () => void
  peopleAccessSlot?: ReactNode
  adminTransferSlot?: ReactNode
}

export function ProjectSettingsPanel({
  name,
  status,
  description,
  saving,
  saved,
  onNameChange,
  onStatusChange,
  onDescriptionChange,
  onSave,
  peopleAccessSlot,
  adminTransferSlot,
}: ProjectSettingsPanelProps) {
  return (
    <div className="flex-1 overflow-auto pb-6">
      <div className="max-w-4xl space-y-6">
        <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Project settings</p>
          <h2 className="mt-1 text-2xl font-headline font-bold text-on-surface">Manage this board</h2>
          <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">Update the client-facing project details while keeping the same polished board styling.</p>
        </div>
        <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="project-settings-name" className="block text-xs font-label uppercase tracking-widest text-on-surface-variant mb-2">Project Name</label>
              <input
                id="project-settings-name"
                type="text"
                value={name}
                onChange={e => onNameChange(e.target.value)}
                className="w-full rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
              />
            </div>
            <div>
              <label htmlFor="project-settings-status" className="block text-xs font-label uppercase tracking-widest text-on-surface-variant mb-2">Status</label>
              <select
                id="project-settings-status"
                value={status}
                onChange={e => onStatusChange(e.target.value)}
                className="w-full rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
              >
                <option value="discovery">Discovery</option>
                <option value="design">Design</option>
                <option value="development">Development</option>
                <option value="review">Review</option>
                <option value="live">Live</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
              <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Current board</p>
              <p className="mt-2 text-lg font-headline font-bold text-on-surface">{name || 'Untitled project'}</p>
              <p className="mt-1 text-sm capitalize text-on-surface-variant">{status.replace(/_/g, ' ')}</p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="project-settings-description" className="block text-xs font-label uppercase tracking-widest text-on-surface-variant mb-2">Description</label>
              <textarea
                id="project-settings-description"
                value={description}
                onChange={e => onDescriptionChange(e.target.value)}
                className="w-full rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
                rows={5}
              />
            </div>
          </div>
          <div className="mt-6 flex items-center gap-3 border-t border-[var(--color-card-border)] pt-5">
            <button
              onClick={onSave}
              disabled={saving || !name.trim()}
              className="pib-btn-primary text-sm font-label"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            {saved && (
              <span className="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs text-green-300">Saved</span>
            )}
          </div>
        </div>
        {peopleAccessSlot}
        {adminTransferSlot}
      </div>
    </div>
  )
}
