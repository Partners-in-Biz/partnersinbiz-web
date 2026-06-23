'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface DomainRule {
  id: string
  domain: string
  type: 'allow' | 'block'
  reason: string
  autoApprove: boolean
  createdBy?: string
  createdAt?: string | null
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return ''
  }
}

export default function EmailDomainRulesPage() {
  const [allow, setAllow] = useState<DomainRule[]>([])
  const [block, setBlock] = useState<DomainRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [domain, setDomain] = useState('')
  const [type, setType] = useState<'allow' | 'block'>('allow')
  const [reason, setReason] = useState('')
  const [autoApprove, setAutoApprove] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/email/domains')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load rules')
      setAllow((body.data?.allow ?? []) as DomainRule[])
      setBlock((body.data?.block ?? []) as DomainRule[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function addRule(e: React.FormEvent) {
    e.preventDefault()
    if (!domain.trim()) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/admin/email/domains', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: domain.trim().toLowerCase(),
          type,
          reason: reason.trim(),
          autoApprove: type === 'allow' ? autoApprove : false,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to add rule')
      setNotice(`${type === 'allow' ? 'Allow' : 'Block'} rule for "${domain.trim()}" saved.`)
      setDomain('')
      setReason('')
      setAutoApprove(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add rule')
    } finally {
      setSaving(false)
    }
  }

  async function removeRule(rule: DomainRule) {
    if (!confirm(`Remove the ${rule.type} rule for "${rule.domain}"?`)) return
    setBusyId(rule.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/email/domains?id=${encodeURIComponent(rule.id)}`, {
        method: 'DELETE',
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to remove rule')
      setNotice(`Rule for "${rule.domain}" removed.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove rule')
    } finally {
      setBusyId(null)
    }
  }

  function RuleList({ rules, kind }: { rules: DomainRule[]; kind: 'allow' | 'block' }) {
    return (
      <div className="pib-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className={`material-symbols-outlined ${kind === 'allow' ? 'text-green-400' : 'text-red-400'}`}>
            {kind === 'allow' ? 'verified' : 'block'}
          </span>
          <h2 className="text-lg font-headline font-bold text-on-surface">
            {kind === 'allow' ? 'Allowed' : 'Blocked'} ({rules.length})
          </h2>
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
        ) : rules.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No {kind} rules.</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-on-surface">{r.domain}</span>
                    {r.autoApprove && (
                      <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400">
                        Auto-approve
                      </span>
                    )}
                  </div>
                  {r.reason && <p className="text-xs text-on-surface-variant mt-0.5">{r.reason}</p>}
                  {r.createdAt && (
                    <p className="text-[11px] text-on-surface-variant/60 mt-0.5">Added {fmtTime(r.createdAt)}</p>
                  )}
                </div>
                <button
                  onClick={() => removeRule(r)}
                  disabled={busyId === r.id}
                  className="pib-btn-ghost text-xs font-label shrink-0"
                >
                  {busyId === r.id ? '…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Platform / Email
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Email Domain Rules</h1>
          <p className="text-sm text-on-surface-variant mt-0.5 max-w-2xl">
            Allow / block domains and patterns for sending-domain verification. Patterns support
            wildcards, e.g. <span className="font-mono">*.acme.co.za</span> or{' '}
            <span className="font-mono">*@gmail.com</span>. Domain verification should consult these
            rules — a block denies, an allow with auto-approve fast-tracks.
          </p>
        </div>
        <Link href="/admin/email" className="pib-btn-ghost text-sm font-label self-start md:self-auto">
          Back to deliverability
        </Link>
      </div>

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div>
      )}
      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">{notice}</div>
      )}

      <form onSubmit={addRule} className="pib-card p-5 space-y-4">
        <h2 className="text-lg font-headline font-bold text-on-surface">Add a rule</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Domain or pattern</span>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="acme.co.za or *.acme.co.za"
              className="pib-input w-full mt-1 font-mono"
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'allow' | 'block')}
              className="pib-input w-full mt-1"
            >
              <option value="allow">Allow</option>
              <option value="block">Block</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Reason</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this rule exists"
              className="pib-input w-full mt-1"
            />
          </label>
          {type === 'allow' && (
            <label className="flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm text-on-surface">
                Auto-approve sending-domain verification for matches
              </span>
            </label>
          )}
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="pib-btn-primary text-sm font-label">
            {saving ? 'Saving…' : 'Add rule'}
          </button>
        </div>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RuleList rules={allow} kind="allow" />
        <RuleList rules={block} kind="block" />
      </div>
    </div>
  )
}
