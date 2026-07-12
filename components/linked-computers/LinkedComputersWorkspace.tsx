'use client'

import { useCallback, useEffect, useState } from 'react'
import { PairComputerDialog } from './PairComputerDialog'

type Grant = { orgId: string; orgLabel?: string; status: string }
type Mapping = { mappingId: string; orgId: string; workspaceId: string; label: string; status: string }
type Device = { deviceId: string; label: string; platform: string; architecture: string; runtimeVersion: string; status: string; health?: string; lastSeenAt: unknown; grants?: Grant[]; mappings?: Mapping[] }

const SAFE_ERRORS: Record<number, string> = {
  403: 'This organisation no longer grants access to this computer.',
  409: 'This computer is offline or stale. Start the runtime and try again.',
  410: 'This pairing code has expired. Create a new code and try again.',
  422: 'This computer needs a Workspace mapping before it can run files.',
  426: 'This computer must be updated before it can run work.',
}

function safeError(status: number) { return SAFE_ERRORS[status] ?? 'Something went wrong. Try again.' }
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
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaceLabel, setWorkspaceLabel] = useState('')
  const [actions, setActions] = useState<Device | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<Device | null>(null)
  const [now, setNow] = useState(0)

  const load = useCallback(async () => {
    try { const body = await request('/api/v1/linked-computers'); setDevices(Array.isArray(body.data) ? body.data : []); setError('') }
    catch (cause) { setError(safeError(Number((cause as { status?: number }).status))) }
  }, [])
  useEffect(() => { setNow(Date.now()); void load() }, [load])

  async function mutate(url: string, init: RequestInit) {
    try { await request(url, { ...init, headers: { 'content-type': 'application/json', ...init.headers } }); setError('') }
    catch (cause) { setError(safeError(Number((cause as { status?: number }).status))) }
  }

  return <div className="mx-auto max-w-5xl p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="pib-eyebrow">Settings</p><h1 className="pib-page-title mt-2">Linked Computers</h1><p className="mt-2 max-w-2xl text-sm text-on-surface-variant">Run Workspace work on a computer you control. Physical folders stay private on that computer.</p></div>
      <button type="button" onClick={() => setPairing(true)} className="pib-btn-primary">Pair a computer</button>
    </div>
    {error && <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">{error}</p>}
    <div className="mt-6 grid gap-4">
      {devices.map((device) => {
        const lastSeen = seenMs(device.lastSeenAt)
        const online = device.status === 'active' && device.health !== 'degraded' && lastSeen != null && now - lastSeen < 5 * 60_000
        return <article key={device.deviceId} aria-label={device.label} className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="flex items-center gap-2"><h2 className="font-semibold">{device.label}</h2><span className={`rounded-full px-2 py-0.5 text-xs ${online ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-on-surface-variant'}`}>{online ? 'Online' : 'Offline'}</span></div><p className="mt-1 text-xs text-on-surface-variant">{device.platform === 'macos' ? 'macOS' : 'Windows'} · {device.architecture} · Version {device.runtimeVersion}</p></div>
            <div className="flex gap-2"><button type="button" aria-label={`Rename ${device.label}`} onClick={() => { setRenaming(device); setName(device.label) }} className="pib-btn-secondary text-xs">Rename</button><button type="button" aria-label={`Manage access for ${device.label}`} onClick={() => setAccess(device)} className="pib-btn-secondary text-xs">Access</button><button type="button" aria-label={`More actions for ${device.label}`} onClick={() => setActions(device)} className="pib-btn-secondary text-xs">More</button></div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs font-semibold">Organisation access</p>{device.grants?.length ? device.grants.map(g => <p key={g.orgId} className="mt-1 text-sm text-on-surface-variant">{g.orgLabel ?? g.orgId} · {g.status}</p>) : <p className="mt-1 text-sm text-on-surface-variant">No organisation granted</p>}</div>
            <div><p className="text-xs font-semibold">Workspace mappings</p>{device.mappings?.length ? device.mappings.map(m => <p key={m.mappingId} className="mt-1 text-sm text-on-surface-variant">{m.label} · {m.status === 'active' ? 'Mapped' : m.status}</p>) : <p className="mt-1 text-sm text-on-surface-variant">No Workspace mapped</p>}</div>
          </div>
        </article>
      })}
      {!error && devices.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--color-card-border)] p-8 text-center text-sm text-on-surface-variant">No computers linked yet.</p>}
    </div>
    {pairing && <PairComputerDialog onClose={() => setPairing(false)} />}
    {renaming && <div role="dialog" aria-modal="true" aria-label="Rename computer" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><form className="w-full max-w-sm rounded-xl bg-[var(--color-card)] p-5" onSubmit={async e => { e.preventDefault(); await mutate(`/api/v1/linked-computers/${renaming.deviceId}`, { method: 'PATCH', body: JSON.stringify({ label: name }) }); setRenaming(null) }}><label className="block text-sm">Computer name<input aria-label="Computer name" value={name} onChange={e => setName(e.target.value)} className="mt-2 w-full rounded-lg border bg-transparent p-2" /></label><button className="pib-btn-primary mt-4">Save name</button></form></div>}
    {access && <div role="dialog" aria-modal="true" aria-label="Manage computer access" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className="w-full max-w-md rounded-xl bg-[var(--color-card)] p-5"><h2 className="font-semibold">Manage computer access</h2><label className="mt-4 block text-sm">Organisation ID<input aria-label="Organisation ID" value={orgId} onChange={e => setOrgId(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2" /></label><button type="button" className="pib-btn-secondary mt-2" onClick={() => mutate(`/api/v1/linked-computers/${access.deviceId}/grants`, { method: 'PUT', body: JSON.stringify({ orgId, status: 'active' }) })}>Grant organisation</button><label className="mt-4 block text-sm">Workspace ID<input aria-label="Workspace ID" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2" /></label><label className="mt-3 block text-sm">Workspace label<input aria-label="Workspace label" value={workspaceLabel} onChange={e => setWorkspaceLabel(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2" /></label><button type="button" className="pib-btn-secondary mt-2" onClick={() => mutate(`/api/v1/linked-computers/${access.deviceId}/mappings`, { method: 'PUT', body: JSON.stringify({ mappingId: crypto.randomUUID(), orgId, workspaceId, label: workspaceLabel, status: 'active' }) })}>Map Workspace</button><button type="button" className="ml-2 mt-2 text-sm" onClick={() => setAccess(null)}>Done</button></div></div>}
    {actions && <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-2 rounded-xl border bg-[var(--color-card)] p-3"><button type="button" onClick={() => mutate(`/api/v1/linked-computers/${actions.deviceId}/credentials/rotate`, { method: 'POST' })}>Rotate credential</button><button type="button" onClick={() => mutate(`/api/v1/linked-computers/${actions.deviceId}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) })}>Pause computer</button><button type="button" onClick={() => mutate(`/api/v1/linked-computers/${actions.deviceId}`, { method: 'PATCH', body: JSON.stringify({ status: 'revoked' }) })}>Revoke computer</button><button type="button" onClick={() => setConfirmRemove(actions)}>Remove computer</button></div>}
    {confirmRemove && <div role="dialog" aria-modal="true" aria-label="Remove computer" className="fixed inset-0 z-50 grid place-items-center bg-black/60"><div className="rounded-xl bg-[var(--color-card)] p-5"><p>Remove {confirmRemove.label}?</p><button type="button" className="pib-btn-primary mt-4" onClick={async () => { await mutate(`/api/v1/linked-computers/${confirmRemove.deviceId}`, { method: 'DELETE' }); setConfirmRemove(null); setActions(null) }}>Confirm remove</button></div></div>}
  </div>
}
