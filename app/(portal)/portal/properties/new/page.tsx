'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { PropertyType, PropertyStatus } from '@/lib/properties/types'

export default function PortalNewPropertyPage() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [orgId, setOrgId] = useState('')
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [type, setType] = useState<PropertyType>('web')
  const [status, setStatus] = useState<PropertyStatus>('draft')

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then(body => setOrgs(body.data ?? []))
      .catch(() => {})
  }, [])

  async function handleCreate() {
    if (!orgId) { setError('Select a client.'); return }
    if (!name.trim()) { setError('Name is required.'); return }
    if (!domain.trim()) { setError('Domain is required.'); return }

    setSaving(true); setError('')
    try {
      const res = await fetch('/api/v1/properties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, name: name.trim(), domain: domain.trim(), type, status }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Creation failed')
      router.push(`/portal/properties/${body.data.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Creation failed')
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/portal/properties')} className="text-on-surface-variant hover:text-on-surface text-sm">
          ← Properties
        </button>
        <h1 className="text-xl font-headline font-bold text-on-surface">New Property</h1>
      </div>

      <form className="pib-card p-5 space-y-4" onSubmit={e => { e.preventDefault(); handleCreate() }}>
        <div>
          <label className="text-xs text-on-surface-variant font-label block mb-1">Client *</label>
          <select value={orgId} onChange={e => setOrgId(e.target.value)} className="pib-input text-sm w-full">
            <option value="">Select a client…</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-on-surface-variant font-label block mb-1">Name *</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Scrolled Brain" className="pib-input text-sm w-full" />
        </div>
        <div>
          <label className="text-xs text-on-surface-variant font-label block mb-1">Domain *</label>
          <input type="text" value={domain} onChange={e => setDomain(e.target.value)} placeholder="scrolledbrain.com" className="pib-input text-sm w-full" />
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-xs text-on-surface-variant font-label block mb-1">Type</label>
            <select value={type} onChange={e => setType(e.target.value as PropertyType)} className="pib-input text-sm w-full">
              <option value="web">Web</option>
              <option value="ios">iOS</option>
              <option value="android">Android</option>
              <option value="universal">Universal</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-on-surface-variant font-label block mb-1">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as PropertyStatus)} className="pib-input text-sm w-full">
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-red-400 font-label">{error}</p>}
        <button type="submit" disabled={saving} className="pib-btn-primary text-sm font-label w-full">
          {saving ? 'Creating…' : 'Create Property'}
        </button>
      </form>
    </div>
  )
}
