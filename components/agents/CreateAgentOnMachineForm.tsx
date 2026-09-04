'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CreateAgentAccessMode } from '@/lib/orgMembers/agent-runtime-grants'

export type CreateAgentDeviceOption = {
  deviceId: string
  label?: string | null
  deviceKind?: string | null
  ownerType?: 'user' | 'organization' | string | null
  supportsCustomAgents?: boolean
}

export type CreateAgentMemberOption = {
  uid: string
  displayName?: string | null
  email?: string | null
}

export type CreateAgentOnMachineValues = {
  name: string
  role: string
  persona: string
  deviceId: string
  agentHandle?: string
  accessMode: CreateAgentAccessMode
  sharedWithUserIds: string[]
}

export function CreateAgentOnMachineForm({
  devices,
  defaultDeviceId = '',
  members = [],
  compact = false,
  creating = false,
  canCreate = true,
  error = null,
  submitLabel = 'Create agent',
  onSubmit,
}: {
  devices: CreateAgentDeviceOption[]
  defaultDeviceId?: string
  members?: CreateAgentMemberOption[]
  compact?: boolean
  creating?: boolean
  canCreate?: boolean
  error?: string | null
  submitLabel?: string
  onSubmit: (input: CreateAgentOnMachineValues) => void
}) {
  const readyDevices = devices.filter((device) => device.supportsCustomAgents !== false)
  const initialDeviceId = defaultDeviceId && readyDevices.some((device) => device.deviceId === defaultDeviceId)
    ? defaultDeviceId
    : readyDevices[0]?.deviceId ?? ''
  const [deviceId, setDeviceId] = useState(initialDeviceId)
  const [accessMode, setAccessMode] = useState<CreateAgentAccessMode>('personal')
  const [sharedWithUserIds, setSharedWithUserIds] = useState<string[]>([])

  useEffect(() => {
    if (defaultDeviceId) setDeviceId(defaultDeviceId)
  }, [defaultDeviceId])

  const selectedDevice = useMemo(
    () => readyDevices.find((device) => device.deviceId === deviceId) ?? null,
    [deviceId, readyDevices],
  )
  const orgManaged = selectedDevice?.ownerType === 'organization' || selectedDevice?.deviceKind === 'vps'
  const effectiveAccess = orgManaged && accessMode === 'personal' ? 'organization' : accessMode

  const fieldClass = compact
    ? 'h-8 w-full rounded border border-[var(--color-pib-line)] bg-[color-mix(in_srgb,var(--sc-ink)_30%,transparent)] px-2 text-[12px] text-[var(--color-pib-text)]'
    : 'pib-input w-full'
  const areaClass = compact
    ? 'mt-1 w-full rounded border border-[var(--color-pib-line)] bg-[color-mix(in_srgb,var(--sc-ink)_30%,transparent)] px-2 py-1 text-[12px] text-[var(--color-pib-text)]'
    : 'pib-input min-h-24 w-full'

  return (
    <form
      data-testid="create-agent-on-machine"
      className={compact ? 'space-y-2' : 'space-y-4'}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        onSubmit({
          name: String(data.get('name') || '').trim(),
          role: String(data.get('role') || '').trim(),
          persona: String(data.get('persona') || '').trim(),
          deviceId,
          agentHandle: String(data.get('agentHandle') || '').trim() || undefined,
          accessMode: effectiveAccess,
          sharedWithUserIds: effectiveAccess === 'people' ? sharedWithUserIds : [],
        })
      }}
    >
      <input name="name" required maxLength={100} placeholder="Name" className={compact ? `mt-2 ${fieldClass}` : fieldClass} />
      <input name="role" required maxLength={120} placeholder="Role" className={compact ? `mt-1 ${fieldClass}` : fieldClass} />
      <input name="agentHandle" placeholder={compact ? 'handle (optional)' : 'Agent ID (optional)'} className={compact ? `mt-1 ${fieldClass}` : fieldClass} />
      <textarea name="persona" required maxLength={20000} placeholder="Purpose and behaviour" rows={compact ? 3 : 4} className={areaClass} />
      <select
        aria-label="Computer"
        required
        value={deviceId}
        onChange={(event) => setDeviceId(event.target.value)}
        className={compact ? `mt-1 ${fieldClass}` : 'pib-select w-full'}
      >
        {readyDevices.length === 0 ? (
          <option value="">No compatible computer</option>
        ) : readyDevices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.deviceKind === 'vps' ? 'VPS' : 'Computer'} · {device.label || device.deviceId}
          </option>
        ))}
      </select>
      <fieldset className={compact ? 'mt-1 space-y-1' : 'space-y-2'}>
        <legend className={compact ? 'text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]' : 'pib-label'}>
          Who can use this agent
        </legend>
        <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text)]">
          <input
            type="radio"
            name="accessMode"
            checked={effectiveAccess === 'personal'}
            disabled={orgManaged}
            onChange={() => setAccessMode('personal')}
          />
          Just me{orgManaged ? ' (not available on organisation VPS)' : ''}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text)]">
          <input type="radio" name="accessMode" checked={effectiveAccess === 'organization'} onChange={() => setAccessMode('organization')} />
          Organisation owners and admins
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text)]">
          <input type="radio" name="accessMode" checked={effectiveAccess === 'people'} onChange={() => setAccessMode('people')} />
          Specific people
        </label>
      </fieldset>
      {effectiveAccess === 'people' && (
        <div className={compact ? 'max-h-28 space-y-1 overflow-y-auto' : 'max-h-40 space-y-1 overflow-y-auto'}>
          {members.length === 0 ? (
            <p className="text-xs text-[var(--color-pib-text-muted)]">No other members to share with yet.</p>
          ) : members.map((member) => (
            <label key={member.uid} className="flex items-center gap-2 text-xs text-[var(--color-pib-text)]">
              <input
                type="checkbox"
                checked={sharedWithUserIds.includes(member.uid)}
                onChange={() => {
                  setSharedWithUserIds((current) => (
                    current.includes(member.uid)
                      ? current.filter((id) => id !== member.uid)
                      : [...current, member.uid]
                  ))
                }}
              />
              <span className="truncate">{member.displayName || member.email || member.uid}</span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
      <button
        type="submit"
        disabled={!canCreate || creating || readyDevices.length === 0}
        className={compact
          ? 'mt-2 inline-flex h-8 items-center rounded-md border border-[var(--color-pib-line)] px-3 text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-muted)] disabled:opacity-40'
          : 'btn-pib-primary btn-pib-sm disabled:opacity-50'}
      >
        {creating ? 'Creating…' : submitLabel}
      </button>
    </form>
  )
}
