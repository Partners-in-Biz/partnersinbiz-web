'use client'

import { useState } from 'react'

type Pairing = { challengeId: string; secret: string; expiresAt: string }

export function PairComputerDialog({ onClose }: { onClose(): void }) {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  return <div role="dialog" aria-modal="true" aria-labelledby="pair-title" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
    <div className="w-full max-w-lg rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="pair-title" className="text-lg font-semibold">Pair a computer</h2><p className="mt-1 text-sm text-on-surface-variant">Create a one-time code, then enter it in the Partners in Biz runtime on your computer.</p></div>
        <button type="button" aria-label="Close pairing dialog" onClick={onClose} className="p-1">&#10005;</button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
      {pairing ? <div className="mt-5 rounded-xl border border-primary/30 bg-primary/10 p-5 text-center">
        <p className="text-xs uppercase tracking-widest text-on-surface-variant">One-time pairing code</p>
        <p className="mt-2 font-mono text-2xl font-bold tracking-widest">{pairing.secret}</p>
        <p className="mt-2 text-xs text-on-surface-variant">This code expires in 10 minutes and works once.</p>
      </div> : <button type="button" onClick={createCode} disabled={busy} className="pib-btn-primary mt-5">{busy ? 'Creating…' : 'Create pairing code'}</button>}
    </div>
  </div>
}
