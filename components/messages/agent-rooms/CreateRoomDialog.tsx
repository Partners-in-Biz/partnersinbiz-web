'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { AGENT_ROOM_MAX_MEMBERS, AGENT_ROOM_MIN_MEMBERS } from '@/lib/agent-rooms/types'

type DeviceOption = {
  deviceId: string
  label: string
  availableAgentIds?: string[]
}

type TeamOption = {
  teamId: string
  name: string
}

type MemberDraft = { agentId: string; deviceId: string }

export function deriveRoomSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
}

export function CreateRoomDialog({
  orgId,
  onCreated,
  onClose,
}: {
  orgId: string
  onCreated: (conversationId: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [pictureUrl, setPictureUrl] = useState('')
  const [members, setMembers] = useState<MemberDraft[]>([
    { agentId: 'pip', deviceId: '' },
    { agentId: 'maya', deviceId: '' },
  ])
  const [humanTeamIds, setHumanTeamIds] = useState<string[]>([])
  const [devices, setDevices] = useState<DeviceOption[]>([])
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      fetch('/api/v1/linked-computers').then(async (response) => {
        if (!response.ok) return []
        const body = await response.json().catch(() => null)
        const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.devices) ? body.data.devices : []
        return rows.filter((row: unknown): row is DeviceOption => (
          Boolean(row && typeof row === 'object' && typeof (row as DeviceOption).deviceId === 'string')
        ))
      }),
      fetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/teams`).then(async (response) => {
        if (!response.ok) return []
        const body = await response.json().catch(() => null)
        const rows = Array.isArray(body?.data?.teams) ? body.data.teams : []
        return rows.filter((row: unknown): row is TeamOption => (
          Boolean(row && typeof row === 'object' && typeof (row as TeamOption).teamId === 'string')
        ))
      }),
    ]).then(([nextDevices, nextTeams]) => {
      if (cancelled) return
      setDevices(nextDevices)
      setTeams(nextTeams)
    })
    return () => {
      cancelled = true
    }
  }, [orgId])

  function updateName(next: string) {
    setName(next)
    if (!slugEdited) setSlug(deriveRoomSlug(next))
  }

  function devicesForAgent(agentId: string): DeviceOption[] {
    return devices.filter((device) => (device.availableAgentIds ?? []).includes(agentId))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !slug.trim()) return
    if (members.length < AGENT_ROOM_MIN_MEMBERS || members.length > AGENT_ROOM_MAX_MEMBERS) {
      setError(`Rooms need ${AGENT_ROOM_MIN_MEMBERS}–${AGENT_ROOM_MAX_MEMBERS} members.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/agent-rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          pictureUrl: pictureUrl.trim() || null,
          members: members.map((member) => ({
            agentId: member.agentId.trim(),
            deviceId: member.deviceId.trim() || null,
          })),
          humanTeamIds,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Could not create room.')
        return
      }
      const conversationId = typeof body?.data?.room?.conversationId === 'string'
        ? body.data.room.conversationId
        : ''
      if (conversationId) onCreated(conversationId)
      else onClose()
    } catch {
      setError('Could not create room.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_srgb,var(--sc-ink)_45%,transparent)] p-3 sm:items-center" role="dialog" aria-label="Create room">
      <form onSubmit={(event) => void handleSubmit(event)} className="w-full max-w-lg space-y-3 rounded-[4px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Rooms</p>
            <h2 className="mt-1 text-base text-[var(--color-pib-text)]">Create room</h2>
          </div>
          <button type="button" className="text-sm text-[var(--color-pib-text-muted)]" onClick={onClose}>
            Close
          </button>
        </div>
        <label className="block text-sm">
          Name
          <input
            aria-label="Room name"
            required
            value={name}
            onChange={(event) => updateName(event.target.value)}
            className="mt-1 w-full rounded-[4px] border border-[var(--color-pib-line)] bg-transparent p-2"
          />
        </label>
        <label className="block text-sm">
          Slug
          <input
            aria-label="Room slug"
            required
            value={slug}
            onChange={(event) => {
              setSlugEdited(true)
              setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
            }}
            className="mt-1 w-full rounded-[4px] border border-[var(--color-pib-line)] bg-transparent p-2"
          />
        </label>
        <label className="block text-sm">
          Picture URL
          <input
            aria-label="Room picture"
            value={pictureUrl}
            onChange={(event) => setPictureUrl(event.target.value)}
            className="mt-1 w-full rounded-[4px] border border-[var(--color-pib-line)] bg-transparent p-2"
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Members</legend>
          {members.map((member, index) => (
            <div key={`${member.agentId}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label className="text-xs">
                Agent
                <input
                  aria-label={`Member ${index + 1} agent`}
                  value={member.agentId}
                  onChange={(event) => {
                    const agentId = event.target.value
                    setMembers((current) => current.map((row, rowIndex) => (
                      rowIndex === index ? { agentId, deviceId: '' } : row
                    )))
                  }}
                  className="mt-1 w-full rounded-[4px] border border-[var(--color-pib-line)] bg-transparent p-2"
                />
              </label>
              <label className="text-xs">
                Device
                <select
                  aria-label={`Member ${index + 1} device`}
                  value={member.deviceId}
                  onChange={(event) => {
                    const deviceId = event.target.value
                    setMembers((current) => current.map((row, rowIndex) => (
                      rowIndex === index ? { ...row, deviceId } : row
                    )))
                  }}
                  className="mt-1 w-full rounded-[4px] border border-[var(--color-pib-line)] bg-transparent p-2"
                >
                  <option value="">Any machine</option>
                  {devicesForAgent(member.agentId).map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                  ))}
                </select>
              </label>
              {members.length > AGENT_ROOM_MIN_MEMBERS && (
                <button
                  type="button"
                  className="self-end text-xs text-[var(--color-pib-text-muted)]"
                  onClick={() => setMembers((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {members.length < AGENT_ROOM_MAX_MEMBERS && (
            <button
              type="button"
              className="btn-pib-secondary btn-pib-sm"
              onClick={() => setMembers((current) => [...current, { agentId: '', deviceId: '' }])}
            >
              Add member
            </button>
          )}
        </fieldset>
        {teams.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Human teams</legend>
            {teams.map((team) => (
              <label key={team.teamId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={team.name}
                  checked={humanTeamIds.includes(team.teamId)}
                  onChange={() => setHumanTeamIds((current) => toggleId(current, team.teamId))}
                />
                {team.name}
              </label>
            ))}
          </fieldset>
        )}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-pib-primary btn-pib-sm" disabled={saving || !name.trim() || !slug.trim()}>
            {saving ? 'Creating…' : 'Create room'}
          </button>
          <button type="button" className="text-sm" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
