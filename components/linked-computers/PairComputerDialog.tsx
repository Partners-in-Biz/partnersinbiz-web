'use client'

import { useEffect, useState } from 'react'
import { AccessibleDialog } from './AccessibleOverlay'

type Pairing = {
  challengeId: string
  secret: string
  expiresAt: string
  requestedPlatform: 'macos' | 'windows' | 'linux'
  adoption?: { sourceLocationId: string; state: 'awaiting_runtime_proof' }
}

export type PairableLegacyLocation = {
  locationId: string
  label: string
  kind: 'vps' | 'computer'
  platform: string
  ownerType: 'organization' | 'user'
  visibility: 'organization' | 'private'
  orgId?: string
  orgName?: string
}

export function PairComputerDialog({
  onClose,
  executionLocations = [],
}: {
  onClose(): void
  executionLocations?: PairableLegacyLocation[]
}) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deviceKind, setDeviceKind] = useState<'computer' | 'vps'>('computer')
  const [ownerType, setOwnerType] = useState<'user' | 'organization'>('user')
  const [ownerOrgId, setOwnerOrgId] = useState('')
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([])
  const [platform, setPlatform] = useState<'macos' | 'windows' | 'linux'>('macos')
  const [adoptLocationId, setAdoptLocationId] = useState('')

  const eligibleLegacyLocations = Array.from(new Map(executionLocations
    .filter((location) => !location.locationId.startsWith('linked-device:')
      && location.kind === deviceKind
      && location.platform === platform
      && location.ownerType === ownerType
      && (ownerType === 'user'
        ? location.visibility === 'private'
        : location.visibility === 'organization' && location.orgId === ownerOrgId))
    .map((location) => [location.locationId, location])).values())
  const adoptionCompleted = Boolean(pairing?.adoption && !executionLocations.some(
    (location) => location.locationId === pairing.adoption?.sourceLocationId,
  ))

  useEffect(() => {
    let cancelled = false
    void fetch('/api/v1/organizations')
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (cancelled || !Array.isArray(body?.data)) return
        setOrganizations(body.data.flatMap((row: unknown) => {
          if (!row || typeof row !== 'object') return []
          const value = row as Record<string, unknown>
          const id = typeof value.id === 'string' ? value.id.trim() : ''
          const name = typeof value.name === 'string' ? value.name.trim() : ''
          return id ? [{ id, name: name || id }] : []
        }))
      })
      .catch(() => setOrganizations([]))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (ownerType === 'organization' && !ownerOrgId && organizations[0]) {
      setOwnerOrgId(organizations[0].id)
    }
  }, [organizations, ownerOrgId, ownerType])

  useEffect(() => {
    if (adoptLocationId && !eligibleLegacyLocations.some((location) => location.locationId === adoptLocationId)) {
      setAdoptLocationId('')
    }
  }, [adoptLocationId, eligibleLegacyLocations])

  async function createCode() {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/v1/linked-computers/pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceKind,
          ownerType,
          ...(ownerType === 'organization' ? { ownerOrgId } : {}),
          ...(adoptLocationId ? { adoptLocationId } : {}),
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error('pairing')
      setPairing({ ...body.data, requestedPlatform: platform })
    } catch { setError('Could not create a pairing code. Try again.') }
    finally { setBusy(false) }
  }

  const pairingDisabled = busy || (ownerType === 'organization' && !ownerOrgId)

  return <AccessibleDialog label="Link a computer or VPS" onClose={onClose} className="w-full max-w-lg rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-card)] p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="pair-title" className="text-lg font-semibold">Link a computer or VPS</h2><p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">Choose its owner, then pair the Partners in Biz runtime with a healthy Hermes installation on that machine.</p></div>
        <button type="button" aria-label="Close pairing dialog" onClick={onClose} className="p-1">&#10005;</button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
      <div className="mt-4 rounded-xl border border-primary/25 bg-primary/10 p-4 text-sm">
        <p className="font-medium">Hermes is required on the linked machine</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--color-pib-text-muted)]">
          <li>Install Hermes Agent and the agent profiles you want to run locally.</li>
          <li>Install and start the Partners in Biz runtime.</li>
          <li>Create the code below and run the pairing command on that machine.</li>
        </ol>
        <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">The runtime checks Hermes before consuming the code. Only healthy agents installed on this computer are offered in Messages; an agent may live here without also living on the VPS.</p>
      </div>
      <fieldset disabled={Boolean(pairing)} className="mt-4"><legend className="text-sm font-medium">Location type</legend><div className="mt-2 grid grid-cols-2 gap-2"><label className="rounded-lg border p-3 text-sm"><input type="radio" name="device-kind" checked={deviceKind === 'computer'} onChange={() => { setDeviceKind('computer'); if (platform === 'linux') setPlatform('macos') }} /> Computer</label><label className="rounded-lg border p-3 text-sm"><input type="radio" name="device-kind" checked={deviceKind === 'vps'} onChange={() => { setDeviceKind('vps'); setPlatform('linux') }} /> VPS</label></div></fieldset>
      <fieldset disabled={Boolean(pairing)} className="mt-4"><legend className="text-sm font-medium">Who owns this location?</legend><div className="mt-2 grid grid-cols-2 gap-2"><label className="rounded-lg border p-3 text-sm"><input type="radio" name="owner-type" checked={ownerType === 'user'} onChange={() => setOwnerType('user')} /> Only me</label><label className="rounded-lg border p-3 text-sm"><input type="radio" name="owner-type" checked={ownerType === 'organization'} onChange={() => { setOwnerType('organization'); setOwnerOrgId((current) => current || organizations[0]?.id || '') }} /> Organisation</label></div></fieldset>
      {ownerType === 'organization' && <label className="mt-4 block text-sm">Organisation<select disabled={Boolean(pairing)} aria-label="Owning organisation" value={ownerOrgId} onChange={(event) => setOwnerOrgId(event.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2"><option value="">Select an organisation</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
      {deviceKind === 'computer' && <fieldset disabled={Boolean(pairing)} className="mt-4"><legend className="text-sm font-medium">Computer platform</legend><div className="mt-2 flex gap-4"><label><input type="radio" name="platform" checked={platform === 'macos'} onChange={() => setPlatform('macos')} /> macOS</label><label><input type="radio" name="platform" checked={platform === 'windows'} onChange={() => setPlatform('windows')} /> Windows</label><label><input type="radio" name="platform" checked={platform === 'linux'} onChange={() => setPlatform('linux')} /> Linux</label></div></fieldset>}
      {eligibleLegacyLocations.length > 0 && <label className="mt-4 block text-sm">Existing project location<select disabled={Boolean(pairing)} aria-label="Existing project location" value={adoptLocationId} onChange={(event) => setAdoptLocationId(event.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2"><option value="">Create as a new location</option>{eligibleLegacyLocations.map((location) => <option key={location.locationId} value={location.locationId}>{location.label}{location.orgName ? ` · ${location.orgName}` : ''} (legacy — pair runtime)</option>)}</select><span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">Choose an existing folder location to preserve its project links. Selection alone does not authenticate the machine.</span></label>}
      {platform === 'linux' && <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-200">Install the authorised Partners in Biz runtime on this Linux machine or VPS, then run the handoff command below. The runtime connects outbound only.</p>}
      {pairing ? <div className="mt-5 rounded-xl border border-primary/30 bg-primary/10 p-5 text-center">
        <p className="text-xs uppercase tracking-widest text-[var(--color-pib-text-muted)]">One-time pairing code</p>
        <p className="mt-2 font-mono text-2xl font-bold tracking-widest">{pairing.secret}</p>
        <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">This code expires in 10 minutes and works once.</p>
        <label className="mt-4 block text-left text-xs">Safe runtime handoff<input readOnly aria-label="Safe runtime handoff" value={`pib-runtime pair --challenge ${pairing.challengeId} --platform ${pairing.requestedPlatform}`} className="mt-1 w-full rounded-lg border bg-transparent p-2 font-mono" /></label>
        {pairing.adoption && (adoptionCompleted
          ? <p role="status" className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-left text-xs text-emerald-200">Authenticated runtime linked. Its existing project links were preserved.</p>
          : <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-left text-xs text-amber-200">{eligibleLegacyLocations.find((location) => location.locationId === pairing.adoption?.sourceLocationId)?.label ?? 'The selected location'} stays a legacy project location until this runtime proves ownership with the one-time code.</p>)}
        <p className="mt-2 text-left text-xs text-[var(--color-pib-text-muted)]">Run this on the selected machine. Pairing stops with a clear error if Hermes is missing or no local agent is healthy. After pairing, map one or more organisation Workspaces.</p>
      </div> : <button type="button" onClick={createCode} disabled={pairingDisabled} className="pib-btn-primary mt-5">{busy ? 'Creating…' : 'Create pairing code'}</button>}
      <button type="button" onClick={onClose} className="ml-2 mt-5 text-sm">{adoptionCompleted ? 'Done' : 'Cancel'}</button>
  </AccessibleDialog>
}
