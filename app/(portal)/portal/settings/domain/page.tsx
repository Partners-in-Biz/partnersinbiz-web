// app/(portal)/portal/settings/domain/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type SslStatus = 'pending' | 'active' | 'failed'

type DomainConfig = {
  subdomain: string
  customDomain: string
  verified: boolean
  sslStatus: SslStatus
  dnsTarget: string
  verifiedAt?: string | null
  lastCheckedAt?: string | null
  lastError?: string | null
}

type DomainResponse = {
  success?: boolean
  data?: { domain: DomainConfig; rootDomain: string }
  error?: string
}

const emptyConfig: DomainConfig = {
  subdomain: '',
  customDomain: '',
  verified: false,
  sslStatus: 'pending',
  dnsTarget: 'cname.partnersinbiz.online',
}

function unwrap(body: DomainResponse): { domain: DomainConfig; rootDomain: string } | null {
  if (body.data) return body.data
  return null
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch { /* clipboard unavailable */ }
      }}
      className="pib-btn-secondary !px-2 !py-1 text-xs"
      aria-label={`Copy ${value}`}
    >
      <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
    </button>
  )
}

function SslBadge({ status, verified }: { status: SslStatus; verified: boolean }) {
  const map: Record<SslStatus, { label: string; cls: string; icon: string }> = {
    active: { label: 'SSL active', cls: 'pib-pill-success', icon: 'lock' },
    pending: { label: verified ? 'SSL provisioning' : 'SSL pending', cls: 'pib-pill', icon: 'hourglass_top' },
    failed: { label: 'SSL failed', cls: 'pib-pill !text-red-400', icon: 'error' },
  }
  const v = map[status]
  return (
    <span className={`${v.cls} inline-flex items-center gap-1.5`}>
      <span className="material-symbols-outlined text-[14px]">{v.icon}</span>
      {v.label}
    </span>
  )
}

export default function DomainSettingsPage() {
  const searchParams = useSearchParams()
  const scope = scopeFromSearchParams(searchParams)
  const endpoint = useMemo(() => scopedApiPath('/api/v1/org/domain', scope), [scope])
  const verifyEndpoint = useMemo(() => scopedApiPath('/api/v1/org/domain/verify', scope), [scope])

  const [config, setConfig] = useState<DomainConfig>(emptyConfig)
  const [rootDomain, setRootDomain] = useState('partnersinbiz.online')
  const [subdomain, setSubdomain] = useState('')
  const [customDomain, setCustomDomain] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(endpoint)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as DomainResponse
        if (!res.ok) throw new Error(body.error ?? 'Failed to load domain settings')
        return body
      })
      .then((body) => {
        if (!alive) return
        const data = unwrap(body)
        if (data) {
          setConfig(data.domain)
          setRootDomain(data.rootDomain)
          setSubdomain(data.domain.subdomain)
          setCustomDomain(data.domain.customDomain)
        }
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load domain settings')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [endpoint])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, customDomain }),
      })
      const body = (await res.json().catch(() => ({}))) as DomainResponse
      if (!res.ok) throw new Error(body.error ?? 'Failed to save domain settings')
      const data = unwrap(body)
      if (data) {
        setConfig(data.domain)
        setSubdomain(data.domain.subdomain)
        setCustomDomain(data.domain.customDomain)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save domain settings')
    }
    setSaving(false)
  }

  async function handleVerify() {
    setVerifying(true)
    setError('')
    try {
      const res = await fetch(verifyEndpoint, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as DomainResponse
      if (!res.ok) throw new Error(body.error ?? 'Verification failed')
      const data = unwrap(body)
      if (data) setConfig(data.domain)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    }
    setVerifying(false)
  }

  const fullSubdomain = subdomain ? `${subdomain}.${rootDomain}` : ''

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 rounded bg-[var(--color-pib-surface-soft)]" />
        <div className="pib-card h-40" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">White-label settings</p>
        <h1 className="pib-page-title mt-2">Custom domain</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Serve your client portal from your own branded address. Pick a subdomain on {rootDomain},
          or point your own domain at the platform with a CNAME record. SSL is provisioned automatically once DNS is verified.
        </p>
      </div>

      {/* Status summary */}
      <div className="pib-card flex flex-wrap items-center gap-3">
        {config.verified ? (
          <span className="pib-pill-success inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px]">verified</span>
            Domain verified
          </span>
        ) : (
          <span className="pib-pill inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px]">pending</span>
            Awaiting verification
          </span>
        )}
        <SslBadge status={config.sslStatus} verified={config.verified} />
        {config.verifiedAt && (
          <span className="text-xs text-[var(--color-pib-text-muted)]">
            Verified {new Date(config.verifiedAt).toLocaleString()}
          </span>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Subdomain</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="domain-subdomain" className="pib-label !mb-0">Subdomain</label>
            <div className="flex items-center gap-2">
              <input
                id="domain-subdomain"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="acme"
                className="pib-input max-w-[200px]"
              />
              <span className="text-sm text-[var(--color-pib-text-muted)]">.{rootDomain}</span>
            </div>
            {fullSubdomain && (
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Your portal will be reachable at <span className="font-medium text-[var(--color-pib-text)]">https://{fullSubdomain}</span>
              </p>
            )}
          </div>
        </div>

        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Custom domain (CNAME)</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="domain-custom" className="pib-label !mb-0">Custom domain</label>
            <input
              id="domain-custom"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value.toLowerCase().trim())}
              placeholder="portal.acme.com"
              className="pib-input max-w-md"
            />
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Use your own domain or subdomain. Add the DNS record below, then click Verify.
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button type="submit" disabled={saving} className="pib-btn-primary disabled:opacity-60">
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save domain settings'}
        </button>
      </form>

      {/* DNS records to add */}
      {customDomain && (
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">DNS records to add</p>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Add this record at your DNS provider for <span className="font-medium text-[var(--color-pib-text)]">{customDomain}</span>.
          </p>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-pib-line)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] text-left text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Name / Host</th>
                  <th className="px-4 py-2 font-medium">Value / Target</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-4 py-3 font-mono text-[var(--color-pib-text)]">CNAME</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-[var(--color-pib-text)]">{customDomain}</code>
                      <CopyButton value={customDomain} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-[var(--color-pib-text)]">{config.dnsTarget}</code>
                      <CopyButton value={config.dnsTarget} />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleVerify} disabled={verifying} className="btn-pib-accent disabled:opacity-60">
              {verifying ? 'Verifying DNS...' : 'Verify'}
            </button>
            <SslBadge status={config.sslStatus} verified={config.verified} />
            {config.lastCheckedAt && (
              <span className="text-xs text-[var(--color-pib-text-muted)]">
                Last checked {new Date(config.lastCheckedAt).toLocaleString()}
              </span>
            )}
          </div>

          {!config.verified && config.lastError && (
            <p className="text-sm text-amber-400">{config.lastError}</p>
          )}
          {config.verified && (
            <p className="inline-flex items-center gap-1.5 text-sm text-[var(--color-pib-success,#22c55e)]">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              DNS verified — your custom domain is live and SSL is active.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
