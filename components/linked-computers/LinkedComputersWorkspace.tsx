'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { PairComputerDialog } from './PairComputerDialog'
import { AccessibleDialog, AccessibleMenu } from './AccessibleOverlay'

type Grant = { orgId: string; orgLabel?: string; status: string; accessMode?: 'owner' | 'organization' | 'selected_users' }
type Mapping = { mappingId: string; orgId: string; workspaceId: string; label: string; status: string }
type Device = { deviceId: string; label: string; platform: string; architecture: string; deviceKind?: 'computer' | 'vps'; ownerType?: 'user' | 'organization'; runtimeVersion: string; status: string; health?: string; lastSeenAt: unknown; grants?: Grant[]; mappings?: Mapping[] }
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
type GrantAccessChoice = 'owner' | 'organization'
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
function grantAccessLabel(grant: Grant) { return grant.accessMode === 'organization' ? 'Everyone in organisation' : grant.accessMode === 'selected_users' ? 'Selected users' : 'Only me' }
function pendingMappingCommand(mappingId: string) { return `pib-runtime map --mapping ${mappingId} --folder <local folder>` }
function seenMs(value: unknown): number | null {
  if (typeof value === 'string') { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null }
  if (value && typeof value === 'object' && 'seconds' in value) return Number((value as { seconds: number }).seconds) * 1000
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
  const [grantAccessMode, setGrantAccessMode] = useState<GrantAccessChoice | null>('owner')
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaceLabel, setWorkspaceLabel] = useState('')
  const [mappingCommand,setMappingCommand]=useState('')
  const [actions, setActions] = useState<Device | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<Device | null>(null)
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

  async function mutate(url: string, init: RequestInit): Promise<boolean> {
    try { await request(url, { ...init, headers: { 'content-type': 'application/json', ...init.headers } }); setError(''); if (!await load()) { setError('Your change was saved, but the latest computer status could not be refreshed. Keep this window open and try again.'); return false } return true }
    catch (cause) { setError(safeError(Number((cause as { status?: number }).status))); return false }
  }
  async function createMapping(){if(!access)return;try{const body=await request(`/api/v1/linked-computers/${access.deviceId}/mappings`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({orgId,workspaceId,label:workspaceLabel})});const id=String(body?.data?.mappingId??'');if(!id)throw new Error('request');setMappingCommand(`pib-runtime map --mapping ${id} --folder <local folder>`);await load()}catch(cause){setError(safeError(Number((cause as {status?:number}).status)))}}

  function openAccessDialog(device: Device) {
    setAccess(device)
    setOrgId('')
    setGrantAccessMode('owner')
    setWorkspaceId('')
    setWorkspaceLabel('')
    setMappingCommand('')
  }

  function selectAccessOrganisation(selectedOrgId: string) {
    setOrgId(selectedOrgId)
    setWorkspaceId('')
    setWorkspaceLabel('')
    setMappingCommand('')
    const existingMode = access?.grants?.find(grant => grant.orgId === selectedOrgId)?.accessMode
    setGrantAccessMode(existingMode === 'organization' || existingMode === 'owner' ? existingMode : existingMode === 'selected_users' ? null : 'owner')
  }

  return <div className="mx-auto max-w-5xl p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="pib-eyebrow">Settings</p><h1 className="pib-page-title mt-2">Linked Computers &amp; VPSs</h1><p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">Connect computers and VPSs, choose who owns them, and use their project folders from Messages.</p></div>
      <button type="button" onClick={() => setPairing(true)} className="pib-btn-primary">Link a computer or VPS</button>
    </div>
    {error && <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">{error}</p>}
    {executionLocations.length > 0 && <section aria-labelledby="project-execution-locations" className="mt-6">
      <div><h2 id="project-execution-locations" className="text-sm font-semibold">Current project locations</h2><p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Existing VPS and computer connections available to project sessions.</p></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{executionLocations.map(location => <article key={`${location.orgId ?? ''}:${location.locationId}`} aria-label={location.label} className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-card)] p-4">
        <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{location.label}</h3><span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{location.kind === 'vps' ? 'VPS' : 'Computer'}</span></div><p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{platformLabel(location.platform)} · {location.ownerType === 'organization' ? 'Organisation-owned' : 'User-owned'}</p></div><span className={`rounded-full px-2 py-0.5 text-xs ${location.selectable ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-[var(--color-pib-text-muted)]'}`}>{location.selectable ? 'Online' : 'Computer unavailable'}</span></div>
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">{location.visibility === 'organization' ? 'Everyone in organisation' : 'Only me'}{location.orgName ? ` · ${location.orgName}` : ''}</p>{location.locationId.startsWith('linked-device:') ? <p className="mt-2 text-xs text-emerald-300">Authenticated runtime</p> : <p className="mt-2 text-xs text-amber-200">Legacy project location · Authenticated runtime pairing required</p>}
      </article>)}</div>
    </section>}
    <div className="mt-6 grid gap-4">
      {devices.map((device) => {
        const lastSeen = seenMs(device.lastSeenAt)
        const online = device.status === 'active' && device.health !== 'degraded' && lastSeen != null && now - lastSeen < 5 * 60_000
        return <article key={device.deviceId} aria-label={device.label} className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-card)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="flex items-center gap-2"><h2 className="font-semibold">{device.label}</h2><span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{device.deviceKind === 'vps' ? 'VPS' : 'Computer'}</span><span className={`rounded-full px-2 py-0.5 text-xs ${online ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-[var(--color-pib-text-muted)]'}`}>{online ? 'Online' : 'Computer unavailable'}</span></div><p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{platformLabel(device.platform)} · {device.ownerType === 'organization' ? 'Organisation-owned' : 'User-owned'} · {device.architecture} · Version {device.runtimeVersion}</p></div>
            <div className="flex gap-2"><button type="button" aria-label={`Rename ${device.label}`} onClick={() => { setRenaming(device); setName(device.label) }} className="pib-btn-secondary text-xs">Rename</button><button type="button" aria-label={`Manage access for ${device.label}`} onClick={() => openAccessDialog(device)} className="pib-btn-secondary text-xs">Access</button><button type="button" aria-label={`More actions for ${device.label}`} aria-haspopup="menu" aria-expanded={actions?.deviceId === device.deviceId} aria-controls={actions?.deviceId === device.deviceId ? actionsMenuId : undefined} onClick={() => setActions(device)} className="pib-btn-secondary text-xs">More</button></div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs font-semibold">Organisation access</p>{device.grants?.length ? device.grants.map(g => <p key={g.orgId} className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{g.orgLabel ?? g.orgId} · {grantAccessLabel(g)} · {g.status}</p>) : <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">No organisation granted</p>}</div>
            <div><p className="text-xs font-semibold">Workspace mappings</p>{device.mappings?.length ? device.mappings.map(m => <div key={m.mappingId} className="mt-1"><p className="text-sm text-[var(--color-pib-text-muted)]">{m.label} · {m.status === 'active' ? 'Mapped' : m.status === 'pending' ? 'Pending local setup' : m.status}</p>{m.status === 'pending' && <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-2"><p className="text-xs text-amber-200">Register the existing Workspace root on this machine. The folder path stays local.</p><code aria-label={`Map ${m.label}`} className="mt-1 block break-all text-xs">{pendingMappingCommand(m.mappingId)}</code><button type="button" className="pib-btn-secondary mt-2 text-xs" onClick={() => void navigator.clipboard.writeText(pendingMappingCommand(m.mappingId))}>Copy mapping command</button></div>}</div>) : <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">No Workspace mapped</p>}</div>
          </div>
        </article>
      })}
      {!error && devices.length === 0 && executionLocations.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--color-pib-line)] p-8 text-center text-sm text-[var(--color-pib-text-muted)]">No computers or VPSs linked yet.</p>}
    </div>
    {pairing && <PairComputerDialog executionLocations={executionLocations} onClose={() => { setPairing(false); void Promise.all([load(), loadCatalogue()]) }} />}
    {renaming && <AccessibleDialog label="Rename computer" onClose={() => setRenaming(null)} className="w-full max-w-sm rounded-xl bg-[var(--color-card)] p-5"><form onSubmit={async e => { e.preventDefault(); if (await mutate(`/api/v1/linked-computers/${renaming.deviceId}`, { method: 'PATCH', body: JSON.stringify({ label: name }) })) setRenaming(null) }}><label className="block text-sm">Computer name<input autoFocus aria-label="Computer name" value={name} onChange={e => setName(e.target.value)} className="mt-2 w-full rounded-lg border bg-transparent p-2" /></label><button className="pib-btn-primary mt-4">Save name</button><button type="button" className="ml-3 text-sm" onClick={() => setRenaming(null)}>Cancel</button></form></AccessibleDialog>}
    {access && <AccessibleDialog label="Manage computer access" onClose={() => setAccess(null)}><h2 className="font-semibold">Manage computer access</h2><label className="mt-4 block text-sm">Organisation<select autoFocus aria-label="Organisation" value={orgId} onChange={e => selectAccessOrganisation(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2"><option value="">Select an organisation</option>{Array.from(new Map(workspaceOptions.map(option => [option.orgId, option])).values()).map(option => <option key={option.orgId} value={option.orgId}>{option.orgName}</option>)}</select></label><fieldset className="mt-4 space-y-2" disabled={!orgId}><legend className="text-sm font-medium">Who can use this computer?</legend><label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-pib-line)] p-3 text-sm"><input aria-label="Only me" type="radio" name="computer-access" value="owner" checked={grantAccessMode === 'owner'} onChange={() => setGrantAccessMode('owner')} /><span><span className="block font-medium">Only me</span><span className="mt-0.5 block text-xs text-[var(--color-pib-text-muted)]">Only you can start chats on this computer from this organisation.</span></span></label><label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-pib-line)] p-3 text-sm"><input aria-label="Everyone in organisation" type="radio" name="computer-access" value="organization" checked={grantAccessMode === 'organization'} onChange={() => setGrantAccessMode('organization')} /><span><span className="block font-medium">Everyone in organisation</span><span className="mt-0.5 block text-xs text-[var(--color-pib-text-muted)]">Every organisation member can start chats on this computer.</span></span></label></fieldset>{orgId && grantAccessMode === null && <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">This computer is currently shared with selected users. Choose a new access level to replace it.</p>}<button type="button" disabled={!orgId || grantAccessMode === null} className="pib-btn-secondary mt-3" onClick={() => mutate(`/api/v1/linked-computers/${access.deviceId}/grants`, { method: 'PUT', body: JSON.stringify({ orgId, status: 'active', accessMode: grantAccessMode }) })}>Save organisation access</button><label className="mt-4 block text-sm">Workspace<select aria-label="Workspace" value={workspaceId} onChange={e => { setWorkspaceId(e.target.value); setWorkspaceLabel(workspaceOptions.find(option => option.workspaceId === e.target.value)?.orgName ?? '') }} className="mt-1 w-full rounded-lg border bg-transparent p-2"><option value="">Select a Workspace</option>{workspaceOptions.filter(option => option.orgId === orgId).map(option => <option key={option.workspaceId} value={option.workspaceId}>{option.orgName}</option>)}</select></label><button type="button" disabled={!workspaceId} className="pib-btn-secondary mt-2" onClick={()=>void createMapping()}>Map Workspace</button>{mappingCommand&&<div className="mt-3 rounded-lg border p-3"><p className="text-sm font-medium">Pending local setup</p><p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Run this on your {platformLabel(access.platform)} computer. The folder is entered locally and never sent to PiB.</p><code className="mt-2 block break-all text-xs">{mappingCommand}</code><button type="button" className="pib-btn-secondary mt-2 text-xs" onClick={()=>void navigator.clipboard.writeText(mappingCommand)}>Copy command</button></div>}<button type="button" className="ml-2 mt-2 text-sm" onClick={() => setAccess(null)}>Done</button></AccessibleDialog>}
    {actions && <AccessibleMenu id={actionsMenuId} label={`Actions for ${actions.label}`} onClose={() => setActions(null)}><button role="menuitem" type="button" onClick={() => { const selected = actions; setActions(null); void mutate(`/api/v1/linked-computers/${selected.deviceId}/credentials/rotate`, { method: 'POST' }) }}>Rotate credential</button><button role="menuitem" type="button" onClick={() => { const selected = actions; setActions(null); void mutate(`/api/v1/linked-computers/${selected.deviceId}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) }) }}>Pause computer</button><button role="menuitem" type="button" onClick={() => { const selected = actions; setActions(null); void mutate(`/api/v1/linked-computers/${selected.deviceId}`, { method: 'PATCH', body: JSON.stringify({ status: 'revoked' }) }) }}>Revoke computer</button><button role="menuitem" type="button" onClick={() => { setConfirmRemove(actions); setActions(null) }}>Remove computer</button></AccessibleMenu>}
    {confirmRemove && <AccessibleDialog label="Remove computer" onClose={() => setConfirmRemove(null)}><p>Remove {confirmRemove.label}?</p><button autoFocus type="button" className="pib-btn-primary mt-4" onClick={async () => { if (await mutate(`/api/v1/linked-computers/${confirmRemove.deviceId}`, { method: 'DELETE' })) { setConfirmRemove(null); setActions(null) } }}>Confirm remove</button><button type="button" className="ml-3 text-sm" onClick={() => setConfirmRemove(null)}>Cancel</button></AccessibleDialog>}
  </div>
}
