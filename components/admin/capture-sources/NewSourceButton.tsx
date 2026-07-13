'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CaptureSourceType } from '@/lib/lead-capture/types'

export function NewSourceButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<CaptureSourceType>('newsletter')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/v1/capture-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, fields: [] }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Could not create capture source')
        return
      }
      router.push(`/admin/capture-sources/${body.data.id}`)
      router.refresh()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
      setError('Network error')
    } finally {
      setCreating(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-pib-primary text-sm"
      >
        New capture source
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Newsletter signup"
        className="pib-input w-48"
        onKeyDown={(e) => e.key === 'Enter' && create()}
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as CaptureSourceType)}
        className="pib-input"
      >
        <option value="newsletter">Newsletter</option>
        <option value="lead-magnet">Lead magnet</option>
        <option value="contact-form">Contact form</option>
        <option value="embed-widget">Embed widget</option>
        <option value="api">API</option>
      </select>
      <button
        onClick={create}
        disabled={creating}
        className="btn-pib-primary text-sm disabled:opacity-50"
      >
        {creating ? 'Creating…' : 'Create'}
      </button>
      <button
        onClick={() => { setOpen(false); setError(''); setName('') }}
        className="px-4 py-2 rounded-lg bg-[var(--color-pib-surface-soft)] text-[var(--color-pib-text)] text-sm"
      >
        Cancel
      </button>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
    </div>
  )
}
