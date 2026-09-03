'use client'

import { useEffect, useState } from 'react'
import { AccessibleDialog } from './AccessibleOverlay'

export type ShareAccessMode = 'owner' | 'organization' | 'selected_users' | 'teams'

export interface ShareDeviceDialogProps {
  device: { deviceId: string; label: string; ownerType?: 'user' | 'organization' }
  orgId: string
  orgName?: string
  grant: { orgId: string; accessMode?: string; allowedUserIds?: string[]; allowedTeamIds?: string[] } | null
  teams: Array<{ teamId: string; name: string }>
  members: Array<{ uid: string; displayName: string }>
  teamsEnabled: boolean
  onSubmit(input: { accessMode: ShareAccessMode; allowedUserIds: string[]; allowedTeamIds: string[] }): Promise<void>
  onClose(): void
}

export const PERSONAL_DEVICE_TRUST_FLOOR =
  'Agents for this organisation run on your computer as your user. Sharing lets the people you pick start work there.'

export function grantAccessLabel(grant: { accessMode?: string }): string {
  if (grant.accessMode === 'organization') return 'Everyone in organisation'
  if (grant.accessMode === 'selected_users') return 'Selected people'
  if (grant.accessMode === 'teams') return 'Teams'
  return 'Only me'
}

function initialMode(
  grant: ShareDeviceDialogProps['grant'],
  teamsEnabled: boolean,
): ShareAccessMode {
  const mode = grant?.accessMode
  if (mode === 'organization' || mode === 'selected_users' || mode === 'owner') return mode
  if (mode === 'teams' && teamsEnabled) return 'teams'
  return 'owner'
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
}

export function ShareDeviceForm({
  device,
  orgId,
  grant,
  teams,
  members,
  teamsEnabled,
  onSubmit,
  disabled = false,
}: Omit<ShareDeviceDialogProps, 'onClose'> & { disabled?: boolean }) {
  const [accessMode, setAccessMode] = useState<ShareAccessMode>(() => initialMode(grant, teamsEnabled))
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>(() => [...(grant?.allowedUserIds ?? [])])
  const [allowedTeamIds, setAllowedTeamIds] = useState<string[]>(() => [...(grant?.allowedTeamIds ?? [])])
  const [saving, setSaving] = useState(false)
  const grantKey = [
    orgId,
    grant?.accessMode ?? '',
    (grant?.allowedUserIds ?? []).join(','),
    (grant?.allowedTeamIds ?? []).join(','),
    String(teamsEnabled),
  ].join(':')

  useEffect(() => {
    setAccessMode(initialMode(grant, teamsEnabled))
    setAllowedUserIds([...(grant?.allowedUserIds ?? [])])
    setAllowedTeamIds([...(grant?.allowedTeamIds ?? [])])
    // grantKey captures org + grant fields so a new grant object identity does not reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantKey])

  const canSubmit =
    Boolean(orgId)
    && !saving
    && !disabled
    && (
      accessMode === 'owner'
      || accessMode === 'organization'
      || (accessMode === 'selected_users' && allowedUserIds.length > 0)
      || (accessMode === 'teams' && (allowedTeamIds.length > 0 || allowedUserIds.length > 0))
    )

  async function handleSubmit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      await onSubmit({
        accessMode,
        allowedUserIds: accessMode === 'selected_users' || accessMode === 'teams' ? allowedUserIds : [],
        allowedTeamIds: accessMode === 'teams' ? allowedTeamIds : [],
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {device.ownerType !== 'organization' && (
        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
          {PERSONAL_DEVICE_TRUST_FLOOR}
        </p>
      )}
      <fieldset className="mt-3 space-y-2" disabled={!orgId || disabled}>
        <legend className="text-sm font-medium">Who can use this computer?</legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-pib-line)] p-2.5 text-sm">
          <input
            aria-label="Only me"
            type="radio"
            name="computer-access"
            value="owner"
            checked={accessMode === 'owner'}
            onChange={() => setAccessMode('owner')}
          />
          <span>
            <span className="block font-medium">Only me</span>
            <span className="mt-0.5 block text-xs text-[var(--color-pib-text-muted)]">
              Only you can start chats on this computer from this organisation.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-pib-line)] p-2.5 text-sm">
          <input
            aria-label="Everyone in organisation"
            type="radio"
            name="computer-access"
            value="organization"
            checked={accessMode === 'organization'}
            onChange={() => setAccessMode('organization')}
          />
          <span>
            <span className="block font-medium">Everyone in organisation</span>
            <span className="mt-0.5 block text-xs text-[var(--color-pib-text-muted)]">
              Every organisation member can start chats on this computer.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-pib-line)] p-2.5 text-sm">
          <input
            aria-label="Selected people"
            type="radio"
            name="computer-access"
            value="selected_users"
            checked={accessMode === 'selected_users'}
            onChange={() => setAccessMode('selected_users')}
          />
          <span>
            <span className="block font-medium">Selected people</span>
            <span className="mt-0.5 block text-xs text-[var(--color-pib-text-muted)]">
              Only the people you pick can start work on this computer.
            </span>
          </span>
        </label>
        {teamsEnabled && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-pib-line)] p-2.5 text-sm">
            <input
              aria-label="Teams"
              type="radio"
              name="computer-access"
              value="teams"
              checked={accessMode === 'teams'}
              onChange={() => setAccessMode('teams')}
            />
            <span>
              <span className="block font-medium">Teams</span>
              <span className="mt-0.5 block text-xs text-[var(--color-pib-text-muted)]">
                Everyone in the selected teams can start work here. You can also add extra people.
              </span>
            </span>
          </label>
        )}
      </fieldset>
      {accessMode === 'selected_users' && (
        <div className="mt-3 space-y-1.5">
          <p className="text-sm font-medium">People</p>
          {members.length === 0 ? (
            <p className="text-xs text-[var(--color-pib-text-muted)]">No people to share with yet.</p>
          ) : members.map((member) => (
            <label key={member.uid} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={member.displayName}
                checked={allowedUserIds.includes(member.uid)}
                onChange={() => setAllowedUserIds((current) => toggleId(current, member.uid))}
              />
              {member.displayName}
            </label>
          ))}
        </div>
      )}
      {accessMode === 'teams' && teamsEnabled && (
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Teams</p>
            {teams.length === 0 ? (
              <p className="text-xs text-[var(--color-pib-text-muted)]">No teams in this organisation yet.</p>
            ) : teams.map((team) => (
              <label key={team.teamId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={team.name}
                  checked={allowedTeamIds.includes(team.teamId)}
                  onChange={() => setAllowedTeamIds((current) => toggleId(current, team.teamId))}
                />
                {team.name}
              </label>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">People (optional)</p>
            {members.length === 0 ? (
              <p className="text-xs text-[var(--color-pib-text-muted)]">No extra people to add.</p>
            ) : members.map((member) => (
              <label key={member.uid} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={member.displayName}
                  checked={allowedUserIds.includes(member.uid)}
                  onChange={() => setAllowedUserIds((current) => toggleId(current, member.uid))}
                />
                {member.displayName}
              </label>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        disabled={!canSubmit}
        className="btn-pib-secondary btn-pib-sm mt-3"
        onClick={() => void handleSubmit()}
      >
        {saving ? 'Saving…' : 'Save organisation access'}
      </button>
    </>
  )
}

export function ShareDeviceDialog(props: ShareDeviceDialogProps) {
  return (
    <AccessibleDialog label={`Share ${props.device.label}`} onClose={props.onClose}>
      <h2 className="text-sm font-medium">Share {props.device.label}</h2>
      <ShareDeviceForm {...props} />
      <button type="button" className="ml-2 mt-2 text-sm" onClick={props.onClose}>
        Cancel
      </button>
    </AccessibleDialog>
  )
}
