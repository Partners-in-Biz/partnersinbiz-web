'use client'

import { useEffect, useState } from 'react'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  orgId: string
  role: string
  lastUsedAt?: any
  createdAt?: any
  expiresAt?: any
}

function formatDate(ts: any) {
  if (!ts) return 'Never'
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyRole, setNewKeyRole] = useState<'ai' | 'admin'>('ai')
  const [newOrgId, setNewOrgId] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/v1/platform/api-keys')
      .then(r => r.json())
      .then(body => { setKeys(body.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newKeyName.trim()) return
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/v1/platform/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName, role: newKeyRole, orgId: newOrgId }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed')
      setCreatedKey(body.data.rawKey)
      setKeys(prev => [...prev, { id: body.data.id, name: newKeyName, keyPrefix: body.data.keyPrefix, orgId: newOrgId, role: newKeyRole, lastUsedAt: null }])
      setNewKeyName('')
      setNewOrgId('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm('Revoke this API key? Any agents using it will lose access.')) return
    await fetch(`/api/v1/platform/api-keys/${keyId}`, { method: 'DELETE' })
    setKeys(prev => prev.filter(k => k.id !== keyId))
  }

  const inputClass = "st-input"

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header>
        <p className="eyebrow">Admin · Settings</p>
        <h1 className="pib-page-title mt-2">API Keys</h1>
        <p className="pib-page-sub">Manage API keys for AI agents and integrations.</p>
      </header>

      {/* New key revealed */}
      {createdKey && (
        <div className="st-panel" style={{ borderColor: 'var(--color-pib-green)' }}>
          <p className="text-sm font-medium text-[var(--color-pib-text)] mb-2">✓ API key created - copy it now</p>
          <p className="text-xs text-[var(--color-pib-text-muted)] mb-3">This key will only be shown once. Store it securely.</p>
          <div className="flex gap-2">
            <code className="flex-1 text-xs bg-[var(--color-pib-ink)] px-3 py-2 rounded font-mono text-[var(--color-pib-green)] break-all">{createdKey}</code>
            <button
              onClick={() => { copyToClipboard(createdKey); setCreatedKey(null) }}
              className="st-btn st-btn--primary text-xs font-label shrink-0"
            >
              Copy & Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create new key */}
      <div className="st-panel space-y-4">
        <p className="sc-tiny">Create New Key</p>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--color-pib-text-muted)] block mb-1.5">Key Name *</label>
              <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} className={inputClass} placeholder='e.g. "Social Agent"' aria-label="Key name" />
            </div>
            <div>
              <label className="text-xs text-[var(--color-pib-text-muted)] block mb-1.5">Role</label>
              <select value={newKeyRole} onChange={e => setNewKeyRole(e.target.value as 'ai' | 'admin')} className={inputClass} aria-label="Key role">
                <option value="ai">AI Agent</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-[var(--color-pib-text-muted)] block mb-1.5">Org ID (leave empty for platform-level access)</label>
              <input value={newOrgId} onChange={e => setNewOrgId(e.target.value)} className={inputClass} placeholder="org-id or leave blank for global" aria-label="Organisation ID" />
            </div>
          </div>
          {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
          <button type="submit" disabled={creating || !newKeyName.trim()} className="st-btn st-btn--primary">
            {creating ? 'Creating…' : 'Generate Key'}
          </button>
        </form>
      </div>

      {/* Existing keys */}
      <div className="st-panel overflow-hidden !p-0">
        <div className="px-5 py-3 border-b border-[var(--color-pib-line)]">
          <p className="sc-tiny">Active Keys</p>
        </div>
        {loading ? (
          <div className="divide-y divide-[var(--color-pib-line)]">
            {[1,2].map(i => <div key={i} className="px-5 py-4"><Skeleton className="h-5 w-48" /></div>)}
          </div>
        ) : keys.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-[var(--color-pib-text-muted)] text-sm">No API keys yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-pib-line)]">
            {keys.map(key => (
              <div key={key.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[var(--color-row-hover)] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-pib-text)]">{key.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <code className="text-[10px] font-mono text-[var(--color-pib-text-muted)]">{key.keyPrefix}••••••••</code>
                    <span className="st-status st-status st-status--info text-[9px]">{key.role}</span>
                    {key.orgId && <span className="text-[9px] text-[var(--color-pib-text-muted)]">org: {key.orgId}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-[var(--color-pib-text-muted)]">Last used: {formatDate(key.lastUsedAt)}</p>
                </div>
                <button onClick={() => handleRevoke(key.id)} className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--st-danger)] transition-colors font-label shrink-0">
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
