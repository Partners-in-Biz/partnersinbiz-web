'use client'

import { useEffect, useState } from 'react'
import { AccessibleDialog } from './AccessibleOverlay'
import {
import { Icon } from '@/components/studio'

  HERMES_MODEL_PROVIDERS,
  HERMES_PROFILE_PRESETS,
  linkedComputerBootstrapCommand,
  linkedComputerBootstrapReady,
  linkedComputerSetupDownload,
  sanitizeHermesProfiles,
  sanitizeHermesProviders,
} from '@/lib/linked-computers/bootstrap'

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
  const [profiles, setProfiles] = useState<string[]>(['pip'])
  const [providers, setProviders] = useState<string[]>(['nous'])
  const [customProfile, setCustomProfile] = useState('')
  const [copied, setCopied] = useState(false)

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
  const requestedProfiles = sanitizeHermesProfiles([...profiles, customProfile])
  const requestedProviders = sanitizeHermesProviders(providers)
  const guidedSetupReady = linkedComputerBootstrapReady(platform)
  const platformLabel = platform === 'macos' ? 'macOS' : platform === 'windows' ? 'Windows' : 'Linux'
  const bootstrapCommand = pairing ? linkedComputerBootstrapCommand({
    platform: pairing.requestedPlatform,
    challengeId: pairing.challengeId,
    profiles: requestedProfiles,
    providers: requestedProviders,
  }) : ''
  const downloadSetup = () => {
    if (!pairing) return
    const setup = linkedComputerSetupDownload({
      platform: pairing.requestedPlatform,
      challengeId: pairing.challengeId,
      profiles: requestedProfiles,
      providers: requestedProviders,
    })
    const url = URL.createObjectURL(new Blob([setup.content], { type: setup.mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.download = setup.filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const toggleChoice = (value: string, current: string[], update: (values: string[]) => void) => {
    if (current.includes(value) && current.length === 1) return
    update(current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  }

  return <AccessibleDialog label="Link a computer or VPS" onClose={onClose} className="w-full max-w-lg rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-card)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="pair-title" className="text-lg">Link a computer or VPS</h2><p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">Choose the machine, agents and model providers. When its signed installer is available, one guided command installs Hermes, configures the profiles locally and links the PiB runtime.</p></div>
        <button type="button" aria-label="Close pairing dialog" onClick={onClose} className="p-1">&#10005;</button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-[var(--st-danger)]">{error}</p>}
      <div className="mt-4 rounded-[6px] border border-primary/25 bg-primary/10 p-4 text-sm">
        <p className="font-medium">Hermes is installed as part of linking</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--color-pib-text-muted)]">
          <li>Select the local agent profiles and model providers below.</li>
          <li>Run one setup command on the computer you are linking.</li>
          <li>Enter provider keys only in the local Hermes setup and then enter the one-time PiB code.</li>
        </ol>
        <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Model API keys stay in that computer&apos;s Hermes profile and never pass through Partners in Biz. Local-only agents are supported; they do not also need to exist on the VPS.</p>
      </div>
      {!guidedSetupReady && <div role="status" className="mt-4 rounded-[6px] border border-amber-400/25 bg-[var(--sc-surface)]/10 p-4 text-sm text-[var(--sc-ink-soft)]"><p className="font-medium">{platformLabel} secure installer awaiting release</p><p className="mt-1 text-xs text-[var(--sc-ink-soft)]/75">Pairing stays disabled until the signed runtime bundle is published. This prevents an incomplete or unsigned setup from being handed to a customer.</p></div>}
      <fieldset disabled={Boolean(pairing)} className="mt-4"><legend className="text-sm font-medium">Location type</legend><div className="mt-2 grid grid-cols-2 gap-2"><label className="rounded-lg border p-3 text-sm"><input type="radio" name="device-kind" checked={deviceKind === 'computer'} onChange={() => { setDeviceKind('computer'); if (platform === 'linux') setPlatform('macos') }} /> Computer</label><label className="rounded-lg border p-3 text-sm"><input type="radio" name="device-kind" checked={deviceKind === 'vps'} onChange={() => { setDeviceKind('vps'); setPlatform('linux') }} /> VPS</label></div></fieldset>
      <fieldset disabled={Boolean(pairing)} className="mt-4"><legend className="text-sm font-medium">Who owns this location?</legend><div className="mt-2 grid grid-cols-2 gap-2"><label className="rounded-lg border p-3 text-sm"><input type="radio" name="owner-type" checked={ownerType === 'user'} onChange={() => setOwnerType('user')} /> Only me</label><label className="rounded-lg border p-3 text-sm"><input type="radio" name="owner-type" checked={ownerType === 'organization'} onChange={() => { setOwnerType('organization'); setOwnerOrgId((current) => current || organizations[0]?.id || '') }} /> Organisation</label></div></fieldset>
      {ownerType === 'organization' && <label className="mt-4 block text-sm">Organisation<select disabled={Boolean(pairing)} aria-label="Owning organisation" value={ownerOrgId} onChange={(event) => setOwnerOrgId(event.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2"><option value="">Select an organisation</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
      {deviceKind === 'computer' && <fieldset disabled={Boolean(pairing)} className="mt-4"><legend className="text-sm font-medium">Computer platform</legend><div className="mt-2 flex gap-4"><label><input type="radio" name="platform" checked={platform === 'macos'} onChange={() => setPlatform('macos')} /> macOS</label><label><input type="radio" name="platform" checked={platform === 'windows'} onChange={() => setPlatform('windows')} /> Windows</label><label><input type="radio" name="platform" checked={platform === 'linux'} onChange={() => setPlatform('linux')} /> Linux</label></div></fieldset>}
      <fieldset disabled={Boolean(pairing)} className="mt-4"><legend className="text-sm font-medium">Hermes profiles on this machine</legend><p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Choose up to eight. Each profile can use its own model and API key.</p><div className="mt-2 grid grid-cols-2 gap-2">{HERMES_PROFILE_PRESETS.map((profile) => <label key={profile.id} className={`rounded-lg border p-2.5 text-xs ${profiles.includes(profile.id) ? 'border-primary/40 bg-primary/10' : 'border-[var(--color-card-border)]'}`}><span className="flex items-center gap-2"><input type="checkbox" checked={profiles.includes(profile.id)} onChange={() => toggleChoice(profile.id, profiles, setProfiles)} /> <span className="font-medium">{profile.label}</span></span><span className="mt-1 block pl-5 text-[var(--color-pib-text-muted)]">{profile.description}</span></label>)}</div><label className="mt-2 block text-xs">Custom profile<input value={customProfile} onChange={(event) => setCustomProfile(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32))} placeholder="for example finance" className="mt-1 w-full rounded-lg border bg-transparent p-2" /></label></fieldset>
      <fieldset disabled={Boolean(pairing)} className="mt-4"><legend className="text-sm font-medium">Model access</legend><p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">The local Hermes wizard will ask for sign-in or keys after the installer starts.</p><div className="mt-2 grid grid-cols-2 gap-2">{HERMES_MODEL_PROVIDERS.map((provider) => <label key={provider.id} className={`rounded-lg border p-2.5 text-xs ${providers.includes(provider.id) ? 'border-primary/40 bg-primary/10' : 'border-[var(--color-card-border)]'}`}><span className="flex items-center gap-2"><input type="checkbox" checked={providers.includes(provider.id)} onChange={() => toggleChoice(provider.id, providers, setProviders)} /> <span className="font-medium">{provider.label}</span></span><span className="mt-1 block pl-5 text-[var(--color-pib-text-muted)]">{provider.description}</span></label>)}</div></fieldset>
      {eligibleLegacyLocations.length > 0 && <label className="mt-4 block text-sm">Existing project location<select disabled={Boolean(pairing)} aria-label="Existing project location" value={adoptLocationId} onChange={(event) => setAdoptLocationId(event.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2"><option value="">Create as a new location</option>{eligibleLegacyLocations.map((location) => <option key={location.locationId} value={location.locationId}>{location.label}{location.orgName ? ` · ${location.orgName}` : ''} (legacy  -  pair runtime)</option>)}</select><span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">Choose an existing folder location to preserve its project links. Selection alone does not authenticate the machine.</span></label>}
      {platform === 'linux' && <p className="mt-3 rounded-lg border border-amber-400/20 bg-[var(--sc-surface)]/10 p-3 text-xs text-[var(--sc-ink-soft)]">Install the authorised Partners in Biz runtime on this Linux machine or VPS, then run the handoff command below. The runtime connects outbound only.</p>}
      {pairing ? <div className="mt-5 rounded-[6px] border border-primary/30 bg-primary/10 p-5 text-center">
        <p className="text-xs uppercase tracking-widest text-[var(--color-pib-text-muted)]">One-time pairing code</p>
        <p className="mt-2 font-mono text-2xl tracking-widest">{pairing.secret}</p>
        <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">This code expires in 10 minutes and works once.</p>
        <label className="mt-4 block text-left text-xs">One-command computer setup<textarea readOnly aria-label="One-command computer setup" value={bootstrapCommand} rows={pairing.requestedPlatform === 'windows' ? 4 : 3} className="mt-1 w-full resize-none rounded-lg border bg-transparent p-2 font-mono text-[11px]" /></label>
        <button type="button" onClick={downloadSetup} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary"><Icon name="download" className="text-[15px]" />Download setup file</button>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(bootstrapCommand).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }) }} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary"><Icon name="content_copy" className="text-[15px]" />{copied ? 'Copied' : 'Copy setup command'}</button>
        {pairing.adoption && (adoptionCompleted
          ? <p role="status" className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-left text-xs text-emerald-200">Authenticated runtime linked. Its existing project links were preserved.</p>
          : <p className="mt-2 rounded-lg border border-amber-400/20 bg-[var(--sc-surface)]/10 p-3 text-left text-xs text-[var(--sc-ink-soft)]">{eligibleLegacyLocations.find((location) => location.locationId === pairing.adoption?.sourceLocationId)?.label ?? 'The selected location'} stays a legacy project location until this runtime proves ownership with the one-time code.</p>)}
        <p className="mt-2 text-left text-xs text-[var(--color-pib-text-muted)]">Download and run the setup file, or copy the command into Terminal on macOS/Linux or an Administrator PowerShell on Windows. It installs Hermes when needed, creates the selected profiles, starts their gateways, installs the signed PiB runtime, then asks privately for the code above. After pairing, map one or more organisation Workspaces.</p>
      </div> : <button type="button" onClick={createCode} disabled={pairingDisabled || !guidedSetupReady} title={!guidedSetupReady ? `${platformLabel} signed installer is not published yet` : undefined} className="pib-btn-primary mt-5">{busy ? 'Creating…' : guidedSetupReady ? 'Create pairing code' : `Awaiting signed ${platformLabel} installer`}</button>}
      <button type="button" onClick={onClose} className="ml-2 mt-5 text-sm">{adoptionCompleted ? 'Done' : 'Cancel'}</button>
  </AccessibleDialog>
}
