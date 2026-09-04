'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { PairComputerDialog } from './PairComputerDialog'
import { AccessibleDialog, AccessibleMenu } from './AccessibleOverlay'
import { ShareDeviceForm, grantAccessLabel, type ShareAccessMode } from './ShareDeviceDialog'

type Grant = {
  orgId: string
  orgLabel?: string
  status: string
  accessMode?: ShareAccessMode
  allowedUserIds?: string[]
  allowedTeamIds?: string[]
  browserIdentity?: { useRealProfile: boolean; realProfilePin: string | null; headed: boolean; autoclose: boolean }
}
type Mapping = { mappingId: string; orgId: string; workspaceId: string; label: string; status: string }
type DesiredAgentRow = { agentId: string; keepInSync: boolean; desiredPolicyVersion: string | null; appliedPolicyVersion: string | null; status: string; lastError: string | null }
type Device = { deviceId: string; label: string; platform: string; architecture: string; deviceKind?: 'computer' | 'vps'; ownerType?: 'user' | 'organization'; runtimeVersion: string; status: string; health?: string; healthReason?: 'hermes_unavailable' | 'hermes_binary_missing' | 'no_agents_available' | 'hermes_update_failed' | null; hermesVersion?: string | null; availableAgentIds?: string[]; desiredAgents?: DesiredAgentRow[]; lastSeenAt: unknown; grants?: Grant[]; mappings?: Mapping[] }

function agentSyncStatusLabel(status: string): string {
  switch (status) {
    case 'in_sync': return 'in sync'
    case 'installing': return 'installing'
    case 'installed': return 'installed'
    case 'syncing': return 'syncing'
    case 'drifted': return 'drifted'
    case 'error': return 'error'
    case 'desired': return 'queued'
    default: return status
  }
}

function agentSyncStatusClass(status: string): string {
  if (status === 'in_sync') return 'text-emerald-400'
  if (status === 'drifted' || status === 'error') return 'text-[var(--st-warning)]'
  if (status === 'installing' || status === 'syncing') return 'text-sky-300'
  return 'text-[var(--color-pib-text-muted)]'
}
type WorkspaceOption = { workspaceId: string; orgId: string; orgName: string }
type ExecutionLocation = {
  id: string
  locationId: string
  label: string
  kind: 'vps' | 'computer'
  platform: string
  ownerType: 'organization' | 'user'
  visibility: 'organization' | 'private'
  selectable: boolean
  orgId?: string
  orgName?: string
}
const LINKED_COMPUTERS_REFRESH_INTERVAL = 30_000

const SAFE_ERRORS: Record<number, string> = {
  403: 'This organisation no longer grants access to this computer.',
  409: 'This computer is offline or stale. Start the runtime and try again.',
  410: 'This pairing code has expired. Create a new code and try again.',
  422: 'This computer needs a Workspace mapping before it can run files.',
  426: 'This computer must be updated before it can run work.',
}

function safeError(status: number) { return SAFE_ERRORS[status] ?? 'Something went wrong. Try again.' }
function platformLabel(platform: string) { return platform === 'macos' ? 'macOS' : platform === 'linux' ? 'Linux' : 'Windows' }
function pendingMappingCommand(mappingId: string) { return `pib-runtime map --mapping ${mappingId} --folder <local folder>` }
function seenMs(value: unknown): number | null {
  if (typeof value === 'string') { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null }
  if (value && typeof value === 'object') {
    const timestamp = value as { seconds?: unknown; _seconds?: unknown }
    const seconds = Number(timestamp.seconds ?? timestamp._seconds)
    if (Number.isFinite(seconds)) return seconds * 1000
  }
  return null
}

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  if (!response.ok) throw Object.assign(new Error('request'), { status: response.status })
  return response.json()
}

export function LinkedComputersWorkspace() {
  const [devices, setDevices] = useState<Device[]>([])
  const [error, setError] = useState('')
  const [pairing, setPairing] = useState(false)
  const [renaming, setRenaming] = useState<Device | null>(null)
  const [name, setName] = useState('')
  const [access, setAccess] = useState<Device | null>(null)
  const [orgId, setOrgId] = useState('')
  const [shareTeams, setShareTeams] = useState<Array<{ teamId: string; name: string }>>([])
  const [shareMembers, setShareMembers] = useState<Array<{ uid: string; displayName: string }>>([])
  const [shareTeamsEnabled, setShareTeamsEnabled] = useState(false)
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaceLabel, setWorkspaceLabel] = useState('')
  const [mappingCommand,setMappingCommand]=useState('')
  const [actions, setActions] = useState<Device | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<Device | null>(null)
  const [agentsDevice, setAgentsDevice] = useState<Device | null>(null)
  const [agentsCatalog, setAgentsCatalog] = useState<string[]>([])
  const [agentsDraft, setAgentsDraft] = useState<Array<{ agentId: string; keepInSync: boolean }>>([])
  const [agentsLive, setAgentsLive] = useState<DesiredAgentRow[]>([])
  const [agentsOrgId, setAgentsOrgId] = useState('')
  const [agentsSaving, setAgentsSaving] = useState(false)
  const [agentsMessage, setAgentsMessage] = useState('')
  const [now, setNow] = useState(0)
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([])
  const [executionLocations, setExecutionLocations] = useState<ExecutionLocation[]>([])
  const actionsMenuId = useId()

  const load = useCallback(async (): Promise<boolean> => {
    setNow(Date.now())
    try { const body = await request('/api/v1/linked-computers'); setDevices(Array.isArray(body.data) ? body.data : []); setError(''); return true }
    catch (cause) { setError(safeError(Number((cause as { status?: number }).status))); return false }
  }, [])

  const loadCatalogue = useCallback(async (): Promise<boolean> => {
    try {
      const organizationsResponse = await fetch('/api/v1/organizations')
      const organizationsBody = organizationsResponse.ok ? await organizationsResponse.json() : null
      const organizations: Array<{ id: string; name: string }> = Array.isArray(organizationsBody?.data)
        ? organizationsBody.data.flatMap((row: unknown) => {
            if (!row || typeof row !== 'object') return []
            const organization = row as Record<string, unknown>
            const id = typeof organization.id === 'string' ? organization.id.trim() : ''
            const name = typeof organization.name === 'string' ? organization.name.trim() : ''
            return id ? [{ id, name: name || id }] : []
          })
        : []
      const catalogues = organizations.length > 0
        ? await Promise.all(organizations.map(async (organization) => {
            const response = await fetch(`/api/v1/workspaces?orgId=${encodeURIComponent(organization.id)}`)
            return {
              organization,
              body: response.ok ? await response.json() : null,
            }
          }))
        : [{
            organization: null,
            body: await fetch('/api/v1/workspaces').then(response => response.ok ? response.json() : null),
          }]
      const workspaces = catalogues.flatMap(({ body }) => Array.isArray(body?.data?.workspaces) ? body.data.workspaces : [])
      const locations = catalogues.flatMap(({ organization, body }) => (
        Array.isArray(body?.data?.runtimeTargets) ? body.data.runtimeTargets : []
      ).flatMap((target: Partial<ExecutionLocation>) => (
        typeof target.locationId === 'string'
        && (target.kind === 'vps' || target.kind === 'computer')
        && (target.visibility === 'organization' || target.visibility === 'private')
          ? [{ ...target, ...(organization ? { orgId: organization.id, orgName: organization.name } : {}) } as ExecutionLocation]
          : []
      )))
      setWorkspaceOptions(Array.from(new Map(workspaces.map((workspace: WorkspaceOption) => (
        [`${workspace.orgId}:${workspace.workspaceId}`, workspace]
      ))).values()))
      setExecutionLocations(Array.from(new Map(locations.map(location => (
        [`${location.orgId ?? ''}:${location.locationId}`, location]
      ))).values()))
      return true
    } catch {
      // Preserve the last known catalogue so a transient refresh failure cannot
      // falsely present a legacy location as successfully adopted.
      return false
    }
  }, [])

  useEffect(() => {
    void Promise.all([load(), loadCatalogue()])
    const interval = window.setInterval(() => {
      void Promise.all([load(), loadCatalogue()])
    }, LINKED_COMPUTERS_REFRESH_INTERVAL)
    return () => window.clearInterval(interval)
  }, [load, loadCatalogue])

  useEffect(() => {
    if (!agentsDevice || !agentsOrgId) return
    let cancelled = false
    const refresh = async () => {
      try {
        const query = `?orgId=${encodeURIComponent(agentsOrgId)}`
        const body = await request(`/api/v1/linked-computers/${agentsDevice.deviceId}/agents${query}`)
        if (cancelled) return
        const desired = Array.isArray(body.data?.desiredAgents)
          ? body.data.desiredAgents as DesiredAgentRow[]
          : []
        setAgentsLive(desired)
      } catch {
        // Keep the last known live status if a poll fails.
        return
      }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [agentsDevice, agentsOrgId])

  async function mutate(url: string, init: RequestInit): Promise<boolean> {
    try { await request(url, { ...init, headers: { 'content-type': 'application/json', ...init.headers } }); setError(''); if (!await load()) { setError('Your change was saved, but the latest computer status could not be refreshed. Keep this window open and try again.'); return false } return true }
    catch (cause) { setError(safeError(Number((cause as { status?: number }).status))); return false }
  }
  async function createMapping(){if(!access)return;try{const body=await request(`/api/v1/linked-computers/${access.deviceId}/mappings`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({orgId,workspaceId,label:workspaceLabel})});const id=String(body?.data?.mappingId??'');if(!id)throw new Error('request');setMappingCommand(`pib-runtime map --mapping ${id} --folder <local folder>`);await load()}catch(cause){setError(safeError(Number((cause as {status?:number}).status)))}}

  function openAccessDialog(device: Device) {
    setAccess(device)
    setOrgId('')
    setShareTeams([])
    setShareMembers([])
    setShareTeamsEnabled(false)
    setWorkspaceId('')
    setWorkspaceLabel('')
    setMappingCommand('')
  }

  function selectAccessOrganisation(selectedOrgId: string) {
    setOrgId(selectedOrgId)
    setWorkspaceId('')
    setWorkspaceLabel('')
    setMappingCommand('')
  }

  useEffect(() => {
    if (!access || !orgId) {
      setShareTeams([])
      setShareMembers([])
      setShareTeamsEnabled(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [teamsResponse, membersResponse] = await Promise.all([
          fetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/teams`),
          fetch(`/api/v1/portal/settings/team?orgId=${encodeURIComponent(orgId)}`),
        ])
        if (cancelled) return
        if (teamsResponse.status === 404) {
          setShareTeamsEnabled(false)
          setShareTeams([])
        } else if (teamsResponse.ok) {
          const body = await teamsResponse.json().catch(() => null)
          const rows = Array.isArray(body?.data?.teams) ? body.data.teams : Array.isArray(body?.teams) ? body.teams : []
          setShareTeamsEnabled(true)
          setShareTeams(rows.flatMap((row: unknown) => {
            if (!row || typeof row !== 'object') return []
            const team = row as { teamId?: unknown; name?: unknown }
            return typeof team.teamId === 'string'
              ? [{ teamId: team.teamId, name: typeof team.name === 'string' && team.name.trim() ? team.name : team.teamId }]
              : []
          }))
        } else {
          setShareTeamsEnabled(false)
          setShareTeams([])
        }
        if (membersResponse.ok) {
          const body = await membersResponse.json().catch(() => null)
          const rows = Array.isArray(body?.members) ? body.members : []
          setShareMembers(rows.flatMap((row: unknown) => {
            if (!row || typeof row !== 'object') return []
            const member = row as { uid?: unknown; displayName?: unknown; firstName?: unknown; lastName?: unknown }
            const uid = typeof member.uid === 'string' ? member.uid : ''
            if (!uid) return []
            const displayName = typeof member.displayName === 'string' && member.displayName.trim()
              ? member.displayName
              : [member.firstName, member.lastName].filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).join(' ') || uid
            return [{ uid, displayName }]
          }))
        } else {
          setShareMembers([])
        }
      } catch {
        if (!cancelled) {
          setShareTeamsEnabled(false)
          setShareTeams([])
          setShareMembers([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [access, orgId])

  async function saveShareAccess(input: { accessMode: ShareAccessMode; allowedUserIds: string[]; allowedTeamIds: string[] }) {
    if (!access || !orgId) return
    await mutate(`/api/v1/linked-computers/${access.deviceId}/grants`, {
      method: 'PUT',
      body: JSON.stringify({
        orgId,
        status: 'active',
        accessMode: input.accessMode,
        ...(input.accessMode === 'selected_users' || input.accessMode === 'teams' ? { allowedUserIds: input.allowedUserIds } : {}),
        ...(input.accessMode === 'teams' ? { allowedTeamIds: input.allowedTeamIds } : {}),
      }),
    })
  }

  async function openAgentsDialog(device: Device) {
    setAgentsDevice(device)
    setAgentsMessage('')
    const defaultOrgId = device.grants?.find((grant) => grant.status === 'active')?.orgId
      || workspaceOptions[0]?.orgId
      || ''
    setAgentsOrgId(defaultOrgId)
    try {
      const query = defaultOrgId ? `?orgId=${encodeURIComponent(defaultOrgId)}` : ''
      const body = await request(`/api/v1/linked-computers/${device.deviceId}/agents${query}`)
      const catalog = Array.isArray(body.data?.catalogAgentIds) ? body.data.catalogAgentIds as string[] : []
      const desired = Array.isArray(body.data?.desiredAgents)
        ? body.data.desiredAgents as DesiredAgentRow[]
        : (device.desiredAgents ?? [])
      setAgentsLive(desired)
      setAgentsCatalog(catalog)
      setAgentsDraft(catalog.flatMap((agentId) => {
        const existing = desired.find((row) => row.agentId === agentId)
        return existing ? [{ agentId, keepInSync: existing.keepInSync === true }] : []
      }))
    } catch (cause) {
      setAgentsMessage(safeError(Number((cause as { status?: number }).status)))
      setAgentsCatalog([])
      setAgentsLive(device.desiredAgents ?? [])
      setAgentsDraft((device.desiredAgents ?? []).map((row) => ({ agentId: row.agentId, keepInSync: row.keepInSync })))
    }
  }

  async function saveAgents() {
    if (!agentsDevice || !agentsOrgId) {
      setAgentsMessage('Pick an organisation before saving agents.')
      return
    }
    setAgentsSaving(true)
    setAgentsMessage('')
    try {
      const body = await request(`/api/v1/linked-computers/${agentsDevice.deviceId}/agents`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: agentsOrgId, desiredAgents: agentsDraft }),
      })
      const desired = Array.isArray(body.data?.desiredAgents)
        ? body.data.desiredAgents as DesiredAgentRow[]
        : agentsLive
      setAgentsLive(desired)
      setAgentsMessage('Saved. The computer will pull and sync selected agents shortly.')
      await load()
    } catch (cause) {
      setAgentsMessage(safeError(Number((cause as { status?: number }).status)))
    } finally {
      setAgentsSaving(false)
    }
  }

  function toggleAgentDraft(agentId: string) {
    setAgentsDraft((current) => {
      if (current.some((row) => row.agentId === agentId)) {
        return current.filter((row) => row.agentId !== agentId)
      }
      return [...current, { agentId, keepInSync: true }].sort((a, b) => a.agentId.localeCompare(b.agentId))
    })
  }

  function toggleKeepInSync(agentId: string) {
    setAgentsDraft((current) => current.map((row) => (
      row.agentId === agentId ? { ...row, keepInSync: !row.keepInSync } : row
    )))
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-4" data-module-accent="cyan">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="pib-eyebrow">Settings</p>
          <h1 className="pib-page-title mt-1">Linked Computers &amp; VPSs</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
            Connect computers and VPSs, choose who owns them, and use their project folders from Messages.
          </p>
        </div>
        <button type="button" onClick={() => setPairing(true)} className="btn-pib-primary btn-pib-sm shrink-0">
          Link a computer or VPS
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-2.5 text-sm text-red-300">
          {error}
        </p>
      )}
      {executionLocations.length > 0 && (
        <section aria-labelledby="project-execution-locations">
          <div>
            <h2 id="project-execution-locations" className="text-sm font-medium">Current project locations</h2>
            <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
              Existing VPS and computer connections available to project sessions.
            </p>
          </div>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            {executionLocations.map((location) => (
              <article
                key={`${location.orgId ?? ''}:${location.locationId}`}
                aria-label={location.label}
                className="pib-card rounded-md border border-[var(--color-pib-line)] p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{location.label}</h3>
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                        {location.kind === 'vps' ? 'VPS' : 'Computer'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                      {platformLabel(location.platform)} ·{' '}
                      {location.ownerType === 'organization' ? 'Organisation-owned' : 'User-owned'}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] ${
                      location.selectable
                        ? 'bg-emerald-400/10 text-emerald-300'
                        : 'bg-white/5 text-[var(--color-pib-text-muted)]'
                    }`}
                  >
                    {location.selectable ? 'Online' : 'Computer unavailable'}
                  </span>
                </div>
                <p className="mt-2.5 text-sm text-[var(--color-pib-text-muted)]">
                  {location.visibility === 'organization' ? 'Everyone in organisation' : 'Only me'}
                  {location.orgName ? ` · ${location.orgName}` : ''}
                </p>
                {location.locationId.startsWith('linked-device:') ? (
                  <p className="mt-1.5 text-xs text-emerald-300">Authenticated runtime</p>
                ) : (
                  <p className="mt-1.5 text-xs text-[var(--st-warning)]">
                    Legacy project location · Authenticated runtime pairing required
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-3">
        {devices.map((device) => {
          const lastSeen = seenMs(device.lastSeenAt)
          const online =
            device.status === 'active' &&
            device.health !== 'degraded' &&
            lastSeen != null &&
            now - lastSeen < 5 * 60_000
          return (
            <article
              key={device.deviceId}
              aria-label={device.label}
              className="pib-card rounded-md border border-[var(--color-pib-line)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium">{device.label}</h2>
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                      {device.deviceKind === 'vps' ? 'VPS' : 'Computer'}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] ${
                        online
                          ? 'bg-emerald-400/10 text-emerald-300'
                          : 'bg-white/5 text-[var(--color-pib-text-muted)]'
                      }`}
                    >
                      {online
                        ? 'Online'
                        : device.healthReason === 'hermes_binary_missing'
                          ? 'Hermes missing'
                          : device.healthReason === 'hermes_unavailable'
                            ? 'Hermes unavailable'
                            : 'Computer unavailable'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                    {platformLabel(device.platform)} ·{' '}
                    {device.ownerType === 'organization' ? 'Organisation-owned' : 'User-owned'} ·{' '}
                    {device.architecture} · Version {device.runtimeVersion}
                    {device.hermesVersion ? ` · Hermes ${device.hermesVersion}` : ''}
                  </p>
                  {device.healthReason === 'hermes_binary_missing' && (
                    <p className="mt-1.5 text-xs text-red-300">
                      Install Hermes on this machine (Linked Computers bootstrap) or set PIB_HERMES_BIN, then restart the runtime.
                    </p>
                  )}
                  {device.healthReason === 'hermes_unavailable' && (
                    <p className="mt-1.5 text-xs text-red-300">
                      Start Hermes and at least one local agent profile on this machine.
                    </p>
                  )}
                  {device.healthReason === 'hermes_update_failed' && (
                    <p className="mt-1.5 text-xs text-[var(--color-pib-text-muted)]">
                      Hermes could not update on this computer. It keeps working on the previous version.
                    </p>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    aria-label={`Rename ${device.label}`}
                    onClick={() => {
                      setRenaming(device)
                      setName(device.label)
                    }}
                    className="btn-pib-secondary btn-pib-sm"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    aria-label={`Manage access for ${device.label}`}
                    onClick={() => openAccessDialog(device)}
                    className="btn-pib-secondary btn-pib-sm"
                  >
                    Access
                  </button>
                  <button
                    type="button"
                    aria-label={`Manage agents for ${device.label}`}
                    onClick={() => void openAgentsDialog(device)}
                    className="btn-pib-secondary btn-pib-sm"
                  >
                    Agents
                  </button>
                  <button
                    type="button"
                    aria-label={`More actions for ${device.label}`}
                    aria-haspopup="menu"
                    aria-expanded={actions?.deviceId === device.deviceId}
                    aria-controls={actions?.deviceId === device.deviceId ? actionsMenuId : undefined}
                    onClick={() => setActions(device)}
                    className="btn-pib-secondary btn-pib-sm"
                  >
                    More
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium">Local agents</p>
                  {device.availableAgentIds?.length ? (
                    <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                      Online: {device.availableAgentIds.join(', ')}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                      No healthy Hermes agents reported
                    </p>
                  )}
                  {device.desiredAgents?.length ? (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {device.desiredAgents.map((row) => (
                        <li key={row.agentId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-[var(--color-pib-text-muted)]">
                            {row.agentId}{row.keepInSync ? ' · keep in sync' : ''}
                          </span>
                          <span className={agentSyncStatusClass(row.status)}>
                            {agentSyncStatusLabel(row.status)}
                          </span>
                          {row.status === 'drifted' || row.status === 'error' ? (
                            <span className="text-[var(--color-pib-text-muted)]">
                              {row.lastError
                                || (row.desiredPolicyVersion && row.appliedPolicyVersion
                                  ? `${row.appliedPolicyVersion} → ${row.desiredPolicyVersion}`
                                  : row.desiredPolicyVersion
                                    ? `wants ${row.desiredPolicyVersion}`
                                    : '')}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs font-medium">Organisation access</p>
                  {device.grants?.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {device.grants.map((g) => {
                        const orgLabel = g.orgLabel
                          || workspaceOptions.find((option) => option.orgId === g.orgId)?.orgName
                          || g.orgId
                        return (
                          <span
                            key={g.orgId}
                            className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                          >
                            {`${orgLabel || g.orgId} · ${grantAccessLabel(g)}`}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">No organisation granted</p>
                  )}
                  {device.ownerType === 'user' && device.grants?.map((grant) => {
                    const ownerOnly = !grant.accessMode || grant.accessMode === 'owner'
                    const enabled = grant.browserIdentity?.useRealProfile === true
                    const orgLabel = grant.orgLabel
                      || workspaceOptions.find((option) => option.orgId === grant.orgId)?.orgName
                      || grant.orgId
                    const saveBrowserIdentity = (next: {
                      useRealProfile: boolean
                      realProfilePin: string | null
                      headed: boolean
                      autoclose: boolean
                    }) => {
                      void mutate(`/api/v1/linked-computers/${device.deviceId}/grants/${grant.orgId}/browser-identity`, {
                        method: 'PUT',
                        body: JSON.stringify(next),
                      })
                    }
                    return (
                      <div key={`browse-${grant.orgId}`} className="mt-3 rounded-lg border border-[var(--color-pib-line)] p-3">
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            aria-label={`Let agents on this computer browse as me for ${orgLabel}`}
                            checked={enabled}
                            disabled={!ownerOnly}
                            onChange={(event) => {
                              saveBrowserIdentity({
                                useRealProfile: event.target.checked,
                                realProfilePin: grant.browserIdentity?.realProfilePin ?? null,
                                headed: grant.browserIdentity?.headed ?? false,
                                autoclose: grant.browserIdentity?.autoclose ?? false,
                              })
                            }}
                          />
                          <span>Let agents on this computer browse as me</span>
                        </label>
                        {ownerOnly ? (
                          <>
                            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">
                              A page the agent visits runs with the user&apos;s real sessions, so prompt injection on that page can act as the user.
                            </p>
                            {enabled ? (
                              <div className="mt-3 space-y-2">
                                <label className="block text-xs">
                                  Browser profile pin
                                  <input
                                    aria-label={`Browser profile pin for ${orgLabel}`}
                                    defaultValue={grant.browserIdentity?.realProfilePin ?? ''}
                                    onBlur={(event) => {
                                      const pin = event.target.value.trim()
                                      saveBrowserIdentity({
                                        useRealProfile: true,
                                        realProfilePin: pin || null,
                                        headed: grant.browserIdentity?.headed ?? false,
                                        autoclose: grant.browserIdentity?.autoclose ?? false,
                                      })
                                    }}
                                    className="mt-1 w-full rounded-lg border bg-transparent p-2 text-sm"
                                  />
                                </label>
                                <label className="flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    aria-label={`Show the browser window for ${orgLabel}`}
                                    checked={grant.browserIdentity?.headed === true}
                                    onChange={(event) => {
                                      saveBrowserIdentity({
                                        useRealProfile: true,
                                        realProfilePin: grant.browserIdentity?.realProfilePin ?? null,
                                        headed: event.target.checked,
                                        autoclose: grant.browserIdentity?.autoclose ?? false,
                                      })
                                    }}
                                  />
                                  Show the browser window
                                </label>
                                {device.platform === 'windows' ? (
                                  <label className="flex items-center gap-2 text-xs">
                                    <input
                                      type="checkbox"
                                      aria-label={`Close the browser after each visit for ${orgLabel}`}
                                      checked={grant.browserIdentity?.autoclose === true}
                                      onChange={(event) => {
                                        saveBrowserIdentity({
                                          useRealProfile: true,
                                          realProfilePin: grant.browserIdentity?.realProfilePin ?? null,
                                          headed: grant.browserIdentity?.headed ?? false,
                                          autoclose: event.target.checked,
                                        })
                                      }}
                                    />
                                    Close the browser after each visit
                                  </label>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Available only when this computer is not shared.</p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div>
                  <p className="text-xs font-medium">Workspace mappings</p>
                  {device.mappings?.length ? (
                    device.mappings.map((m) => (
                      <div key={m.mappingId} className="mt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm text-[var(--color-pib-text-muted)]">
                            {m.label} ·{' '}
                            {m.status === 'active'
                              ? 'Mapped'
                              : m.status === 'pending'
                                ? 'Pending local setup'
                                : m.status}
                          </p>
                          {(m.status === 'active' || m.status === 'pending') && (
                            <button
                              type="button"
                              className="btn-pib-secondary btn-pib-sm"
                              onClick={() => {
                                const next = window.prompt('Location name', m.label)?.trim()
                                if (!next || next === m.label) return
                                void mutate(`/api/v1/linked-computers/${device.deviceId}/mappings`, {
                                  method: 'PUT',
                                  body: JSON.stringify({
                                    orgId: m.orgId,
                                    workspaceId: m.workspaceId,
                                    mappingId: m.mappingId,
                                    label: next,
                                    status: m.status === 'pending' ? 'pending' : 'active',
                                  }),
                                })
                              }}
                            >
                              Rename
                            </button>
                          )}
                        </div>
                        {m.status === 'pending' && (
                          <div className="mt-2 rounded-lg border border-amber-400/20 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] p-2">
                            <p className="text-xs text-[var(--st-warning)]">
                              Register the existing Workspace root on this machine. The folder path stays
                              local.
                            </p>
                            <code
                              aria-label={`Map ${m.label}`}
                              className="mt-1 block break-all text-xs"
                            >
                              {pendingMappingCommand(m.mappingId)}
                            </code>
                            <button
                              type="button"
                              className="btn-pib-secondary btn-pib-sm mt-2"
                              onClick={() =>
                                void navigator.clipboard.writeText(pendingMappingCommand(m.mappingId))
                              }
                            >
                              Copy mapping command
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">No Workspace mapped</p>
                  )}
                </div>
              </div>
            </article>
          )
        })}
        {!error && devices.length === 0 && executionLocations.length === 0 && (
          <p className="rounded-md border border-dashed border-[var(--color-pib-line)] p-6 text-center text-sm text-[var(--color-pib-text-muted)]">
            No computers or VPSs linked yet.
          </p>
        )}
      </div>
      {pairing && (
        <PairComputerDialog
          executionLocations={executionLocations}
          onClose={() => {
            setPairing(false)
            void Promise.all([load(), loadCatalogue()])
          }}
        />
      )}
      {renaming && (
        <AccessibleDialog
          label="Rename computer"
          onClose={() => setRenaming(null)}
          className="w-full max-w-sm rounded-md bg-[var(--color-card)] p-4"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (
                await mutate(`/api/v1/linked-computers/${renaming.deviceId}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ label: name }),
                })
              )
                setRenaming(null)
            }}
          >
            <label className="block text-sm">
              Computer name
              <input
                autoFocus
                aria-label="Computer name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-lg border bg-transparent p-2"
              />
            </label>
            <button className="btn-pib-primary btn-pib-sm mt-3">Save name</button>
            <button type="button" className="ml-3 text-sm" onClick={() => setRenaming(null)}>
              Cancel
            </button>
          </form>
        </AccessibleDialog>
      )}
      {agentsDevice && (
        <AccessibleDialog label={`Agents on ${agentsDevice.label}`} onClose={() => setAgentsDevice(null)}>
          <h2 className="text-sm font-medium">Pull agents onto {agentsDevice.label}</h2>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Select agents to install on this computer. Keep in sync pushes skill-policy updates to every machine that hosts the agent.
          </p>
          <label className="mt-3 block text-sm">
            Organisation
            <select
              aria-label="Organisation for agent sync"
              value={agentsOrgId}
              onChange={(event) => setAgentsOrgId(event.target.value)}
              className="mt-1 w-full rounded-lg border bg-transparent p-2"
            >
              <option value="">Select an organisation</option>
              {Array.from(new Map(workspaceOptions.map((option) => [option.orgId, option])).values()).map((option) => (
                <option key={option.orgId} value={option.orgId}>{option.orgName}</option>
              ))}
            </select>
          </label>
          <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
            {(agentsCatalog.length > 0 ? agentsCatalog : agentsDraft.map((row) => row.agentId)).map((agentId) => {
              const selected = agentsDraft.some((row) => row.agentId === agentId)
              const keepInSync = agentsDraft.find((row) => row.agentId === agentId)?.keepInSync === true
              const online = agentsDevice.availableAgentIds?.includes(agentId)
              const live = agentsLive.find((row) => row.agentId === agentId)
              return (
                <div key={agentId} className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAgentDraft(agentId)}
                    />
                    <span className="font-medium">{agentId}</span>
                    <span className="text-xs text-[var(--color-pib-text-muted)]">{online ? 'online' : 'offline'}</span>
                    {live ? (
                      <span className={`text-xs ${agentSyncStatusClass(live.status)}`}>
                        {agentSyncStatusLabel(live.status)}
                      </span>
                    ) : null}
                  </label>
                  {live?.lastError ? (
                    <p className="mt-1 pl-6 text-xs text-[var(--st-warning)]">
                      {live.lastError.includes('hermes binary not found')
                        ? 'Hermes binary missing  -  install Hermes (bootstrap) or set PIB_HERMES_BIN, then retry pull.'
                        : live.lastError}
                    </p>
                  ) : null}
                  {live?.keepInSync && live.desiredPolicyVersion && live.desiredPolicyVersion !== live.appliedPolicyVersion ? (
                    <p className="mt-1 pl-6 text-xs text-[var(--color-pib-text-muted)]">
                      Policy drift: {live.appliedPolicyVersion || 'none'} → {live.desiredPolicyVersion}
                    </p>
                  ) : null}
                  {selected && (
                    <label className="mt-1 flex items-center gap-2 pl-6 text-xs text-[var(--color-pib-text-muted)]">
                      <input
                        type="checkbox"
                        checked={keepInSync}
                        onChange={() => toggleKeepInSync(agentId)}
                      />
                      Keep in sync with online skill policy
                    </label>
                  )}
                </div>
              )
            })}
          </div>
          {agentsMessage && <p role="status" className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{agentsMessage}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="btn-pib-primary btn-pib-sm"
              disabled={agentsSaving || !agentsOrgId}
              onClick={() => void saveAgents()}
            >
              {agentsSaving ? 'Saving…' : 'Save & pull'}
            </button>
            <button type="button" className="text-sm" onClick={() => setAgentsDevice(null)}>Cancel</button>
          </div>
        </AccessibleDialog>
      )}
      {access && (
        <AccessibleDialog label="Manage computer access" onClose={() => setAccess(null)}>
          <h2 className="text-sm font-medium">Manage computer access</h2>
          <label className="mt-3 block text-sm">
            Organisation
            <select
              autoFocus
              aria-label="Organisation"
              value={orgId}
              onChange={(e) => selectAccessOrganisation(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-transparent p-2"
            >
              <option value="">Select an organisation</option>
              {Array.from(new Map(workspaceOptions.map((option) => [option.orgId, option])).values()).map(
                (option) => (
                  <option key={option.orgId} value={option.orgId}>
                    {option.orgName}
                  </option>
                ),
              )}
            </select>
          </label>
          <ShareDeviceForm
            device={access}
            orgId={orgId}
            orgName={workspaceOptions.find((option) => option.orgId === orgId)?.orgName}
            grant={access.grants?.find((grant) => grant.orgId === orgId) ?? null}
            teams={shareTeams}
            members={shareMembers}
            teamsEnabled={shareTeamsEnabled}
            disabled={!orgId}
            onSubmit={saveShareAccess}
          />
          <label className="mt-3 block text-sm">
            Workspace
            <select
              aria-label="Workspace"
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value)
                setWorkspaceLabel(
                  workspaceOptions.find((option) => option.workspaceId === e.target.value)?.orgName ?? '',
                )
              }}
              className="mt-1 w-full rounded-lg border bg-transparent p-2"
            >
              <option value="">Select a Workspace</option>
              {workspaceOptions
                .filter((option) => option.orgId === orgId)
                .map((option) => (
                  <option key={option.workspaceId} value={option.workspaceId}>
                    {option.orgName}
                  </option>
                ))}
            </select>
          </label>
          <label className="mt-3 block text-sm">
            Location name
            <input
              aria-label="Location name"
              value={workspaceLabel}
              onChange={(e) => setWorkspaceLabel(e.target.value)}
              placeholder="e.g. Partners in Biz or Client Growth"
              className="mt-1 w-full rounded-lg border bg-transparent p-2"
            />
            <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">
              Shown in Messages when this computer has more than one mapped folder.
            </span>
          </label>
          <button
            type="button"
            disabled={!workspaceId || !workspaceLabel.trim()}
            className="btn-pib-secondary btn-pib-sm mt-2"
            onClick={() => void createMapping()}
          >
            Map Workspace
          </button>
          {mappingCommand && (
            <div className="mt-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Pending local setup</p>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                Run this on your {platformLabel(access.platform)} computer. The folder is entered locally
                and never sent to PiB.
              </p>
              <code className="mt-2 block break-all text-xs">{mappingCommand}</code>
              <button
                type="button"
                className="btn-pib-secondary btn-pib-sm mt-2"
                onClick={() => void navigator.clipboard.writeText(mappingCommand)}
              >
                Copy command
              </button>
            </div>
          )}
          <button type="button" className="ml-2 mt-2 text-sm" onClick={() => setAccess(null)}>
            Done
          </button>
        </AccessibleDialog>
      )}
      {actions && (
        <AccessibleMenu
          id={actionsMenuId}
          label={`Actions for ${actions.label}`}
          onClose={() => setActions(null)}
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              const selected = actions
              setActions(null)
              void mutate(`/api/v1/linked-computers/${selected.deviceId}/credentials/rotate`, {
                method: 'POST',
              })
            }}
          >
            Rotate credential
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              const selected = actions
              setActions(null)
              void mutate(`/api/v1/linked-computers/${selected.deviceId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'paused' }),
              })
            }}
          >
            Pause computer
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              const selected = actions
              setActions(null)
              void mutate(`/api/v1/linked-computers/${selected.deviceId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'revoked' }),
              })
            }}
          >
            Revoke computer
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setConfirmRemove(actions)
              setActions(null)
            }}
          >
            Remove computer
          </button>
        </AccessibleMenu>
      )}
      {confirmRemove && (
        <AccessibleDialog label="Remove computer" onClose={() => setConfirmRemove(null)}>
          <p>Remove {confirmRemove.label}?</p>
          <button
            autoFocus
            type="button"
            className="btn-pib-primary btn-pib-sm mt-3"
            onClick={async () => {
              if (
                await mutate(`/api/v1/linked-computers/${confirmRemove.deviceId}`, { method: 'DELETE' })
              ) {
                setConfirmRemove(null)
                setActions(null)
              }
            }}
          >
            Confirm remove
          </button>
          <button type="button" className="ml-3 text-sm" onClick={() => setConfirmRemove(null)}>
            Cancel
          </button>
        </AccessibleDialog>
      )}
    </div>
  )
}
