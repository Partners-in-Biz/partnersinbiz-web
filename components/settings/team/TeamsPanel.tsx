'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

type TeamMemberOption = { uid: string; displayName: string }

type OrgTeamRow = {
  teamId: string
  name: string
  slug?: string
  memberUserIds?: string[]
  leadUserIds?: string[]
  status?: string
}

interface TeamsPanelProps {
  orgId: string
  members: TeamMemberOption[]
}

const ARCHIVE_CONFIRM =
  'Archiving revokes every machine grant and key share that references this team.'

export function deriveTeamSlug(name: string): string {
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

export function TeamsPanel({ orgId, members }: TeamsPanelProps) {
  const [teams, setTeams] = useState<OrgTeamRow[] | null>(null)
  const [hidden, setHidden] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [memberUserIds, setMemberUserIds] = useState<string[]>([])
  const [leadUserIds, setLeadUserIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [archiving, setArchiving] = useState<OrgTeamRow | null>(null)

  const loadTeams = useCallback(async (): Promise<boolean> => {
    const response = await fetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/teams`)
    if (response.status === 404) {
      setHidden(true)
      setTeams(null)
      return false
    }
    if (!response.ok) {
      setError('Could not load teams.')
      setTeams([])
      return false
    }
    const body = await response.json().catch(() => null)
    const rows = Array.isArray(body?.data?.teams)
      ? body.data.teams
      : Array.isArray(body?.teams)
        ? body.teams
        : []
    setHidden(false)
    setTeams(rows.filter((row: unknown): row is OrgTeamRow => (
      Boolean(row && typeof row === 'object' && typeof (row as OrgTeamRow).teamId === 'string')
    )))
    setError('')
    return true
  }, [orgId])

  useEffect(() => {
    let cancelled = false
    void loadTeams().then((ok) => {
      if (cancelled && !ok) return
    })
    return () => {
      cancelled = true
    }
  }, [loadTeams])

  function updateName(next: string) {
    setName(next)
    if (!slugEdited) setSlug(deriveTeamSlug(next))
  }

  function resetCreate() {
    setCreating(false)
    setName('')
    setSlug('')
    setSlugEdited(false)
    setMemberUserIds([])
    setLeadUserIds([])
    setError('')
  }

  function toggleMember(uid: string) {
    setMemberUserIds((current) => {
      const next = toggleId(current, uid)
      if (!next.includes(uid)) {
        setLeadUserIds((leads) => leads.filter((id) => id !== uid))
      }
      return next
    })
  }

  function toggleLead(uid: string) {
    setLeadUserIds((current) => toggleId(current, uid))
    setMemberUserIds((current) => (current.includes(uid) ? current : [...current, uid]))
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !slug.trim()) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/teams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          memberUserIds,
          leadUserIds,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(typeof body?.error === 'string' ? body.error : 'Could not create team.')
        return
      }
      resetCreate()
      await loadTeams()
    } catch {
      setError('Could not create team.')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!archiving) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(
        `/api/v1/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(archiving.teamId)}`,
        { method: 'DELETE' },
      )
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(typeof body?.error === 'string' ? body.error : 'Could not archive team.')
        return
      }
      setArchiving(null)
      await loadTeams()
    } catch {
      setError('Could not archive team.')
    } finally {
      setSaving(false)
    }
  }

  if (hidden || teams === null) return null

  return (
    <section className="pib-card-section" aria-label="Teams">
      <div className="pib-card-section-header flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Teams</p>
          <h2 className="mt-1 text-base text-[var(--color-pib-text)]">Teams</h2>
        </div>
        <button
          type="button"
          className="btn-pib-secondary btn-pib-sm w-fit"
          onClick={() => {
            setCreating(true)
            setArchiving(null)
            setError('')
          }}
        >
          New team
        </button>
      </div>
      <div className="space-y-3 px-5 pb-5">
        {teams.length === 0 && !creating ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No teams yet.</p>
        ) : (
          <ul className="space-y-2">
            {teams.map((team) => (
              <li
                key={team.teamId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-pib-line)] px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--color-pib-text)]">{team.name}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">
                    {team.slug ? `${team.slug} · ` : ''}
                    {team.memberUserIds?.length ?? 0} member{(team.memberUserIds?.length ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-pib-secondary btn-pib-sm"
                  onClick={() => {
                    setArchiving(team)
                    setCreating(false)
                    setError('')
                  }}
                >
                  Archive
                </button>
              </li>
            ))}
          </ul>
        )}

        {creating && (
          <form onSubmit={(event) => void handleCreate(event)} className="space-y-3 rounded-lg border border-[var(--color-pib-line)] p-3">
            <h3 className="text-sm font-medium">Create team</h3>
            <label className="block text-sm">
              Name
              <input
                aria-label="Team name"
                required
                value={name}
                onChange={(event) => updateName(event.target.value)}
                className="mt-1 w-full rounded-lg border bg-transparent p-2"
              />
            </label>
            <label className="block text-sm">
              Slug
              <input
                aria-label="Team slug"
                required
                value={slug}
                onChange={(event) => {
                  setSlugEdited(true)
                  setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                }}
                className="mt-1 w-full rounded-lg border bg-transparent p-2"
              />
            </label>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Members</legend>
              {members.length === 0 ? (
                <p className="text-xs text-[var(--color-pib-text-muted)]">No workspace members to add yet.</p>
              ) : members.map((member) => {
                const selected = memberUserIds.includes(member.uid)
                const lead = leadUserIds.includes(member.uid)
                return (
                  <div key={member.uid} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={member.displayName}
                        checked={selected}
                        onChange={() => toggleMember(member.uid)}
                      />
                      {member.displayName}
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-pib-text-muted)]">
                      <input
                        type="checkbox"
                        aria-label={`Lead ${member.displayName}`}
                        checked={lead}
                        onChange={() => toggleLead(member.uid)}
                      />
                      Lead
                    </label>
                  </div>
                )
              })}
            </fieldset>
            <div className="flex items-center gap-2">
              <button type="submit" className="btn-pib-primary btn-pib-sm" disabled={saving || !name.trim() || !slug.trim()}>
                {saving ? 'Creating…' : 'Create team'}
              </button>
              <button type="button" className="text-sm" onClick={resetCreate}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {archiving && (
          <div className="space-y-2 rounded-lg border border-red-400/25 bg-red-500/10 p-3" role="alertdialog" aria-label="Archive team">
            <p className="text-sm font-medium">Archive {archiving.name}?</p>
            <p className="text-sm text-[var(--color-pib-text-muted)]">{ARCHIVE_CONFIRM}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-pib-primary btn-pib-sm"
                disabled={saving}
                onClick={() => void handleArchive()}
              >
                {saving ? 'Archiving…' : 'Archive team'}
              </button>
              <button type="button" className="text-sm" onClick={() => setArchiving(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-300">{error}</p>
        )}
      </div>
    </section>
  )
}
