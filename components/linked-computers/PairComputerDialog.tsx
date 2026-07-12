'use client'

import { useState } from 'react'
import { AccessibleDialog } from './AccessibleOverlay'

type Pairing = { challengeId: string; secret: string; expiresAt: string }

export function PairComputerDialog({ onClose }: { onClose(): void }) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [platform, setPlatform] = useState<'macos' | 'windows'>('macos')

  async function createCode() {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/v1/linked-computers/pairing', { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error('pairing')
      setPairing(body.data)
    } catch { setError('Could not create a pairing code. Try again.') }
    finally { setBusy(false) }
  }

  return <AccessibleDialog label="Pair a computer" onClose={onClose} className="w-full max-w-lg rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="pair-title" className="text-lg font-semibold">Pair a computer</h2><p className="mt-1 text-sm text-on-surface-variant">Create a one-time code, then enter it in the Partners in Biz runtime on your computer.</p></div>
        <button type="button" aria-label="Close pairing dialog" onClick={onClose} className="p-1">&#10005;</button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
      <fieldset className="mt-4"><legend className="text-sm font-medium">Computer platform</legend><div className="mt-2 flex gap-4"><label><input type="radio" name="platform" checked={platform === 'macos'} onChange={() => setPlatform('macos')} /> macOS</label><label><input type="radio" name="platform" checked={platform === 'windows'} onChange={() => setPlatform('windows')} /> Windows</label></div></fieldset>
      {pairing ? <div className="mt-5 rounded-xl border border-primary/30 bg-primary/10 p-5 text-center">
        <p className="text-xs uppercase tracking-widest text-on-surface-variant">One-time pairing code</p>
        <p className="mt-2 font-mono text-2xl font-bold tracking-widest">{pairing.secret}</p>
        <p className="mt-2 text-xs text-on-surface-variant">This code expires in 10 minutes and works once.</p>
        <label className="mt-4 block text-left text-xs">Safe runtime handoff<input readOnly aria-label="Safe runtime handoff" value={`pib-runtime pair --challenge ${pairing.challengeId} --platform ${platform}`} className="mt-1 w-full rounded-lg border bg-transparent p-2 font-mono" /></label>
        <p className="mt-2 text-left text-xs text-on-surface-variant">Signed installers are delivered in Stage 6. Until then this handoff works only with an authorised development runtime already installed.</p>
      </div> : <button type="button" onClick={createCode} disabled={busy} className="pib-btn-primary mt-5">{busy ? 'Creating…' : 'Create pairing code'}</button>}
      <button type="button" onClick={onClose} className="ml-2 mt-5 text-sm">Cancel</button>
  </AccessibleDialog>
}
