'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ClientVisibilityToggle } from './ClientVisibilityToggle'

type CompanyWorkRecordControlsProps = {
  /** CRM companyId the record is stamped with (omit / empty for org-scoped rows). */
  companyId?: string | null
  /** Current clientVisibility on the record. Unset = shared. */
  clientVisibility?: 'shared' | 'private' | null
  /** API path that accepts PATCH { clientVisibility }. */
  patchPath: string
  /** Optional link to the company page (defaults to /portal/companies/{id}). */
  companyHref?: string
  className?: string
}

type CompanyMeta = {
  name: string
  linkedOrgId?: string
  linkedOrgName?: string
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

/**
 * Header strip for a company-scoped record: company badge + (when the company
 * is linked to another org) the Shared / Keep private toggle.
 */
export function CompanyWorkRecordControls({
  companyId,
  clientVisibility,
  patchPath,
  companyHref,
  className = '',
}: CompanyWorkRecordControlsProps) {
  const id = (companyId ?? '').trim()
  const [meta, setMeta] = useState<CompanyMeta | null>(null)
  const [value, setValue] = useState<'shared' | 'private'>(clientVisibility === 'private' ? 'private' : 'shared')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      const res = await fetch(`/api/v1/crm/companies/${encodeURIComponent(id)}`)
      const body = unwrap(await res.json().catch(() => null))
      if (!res.ok || cancelled || !body) return
      const company = (body.company as Record<string, unknown>) ?? body
      const linkedOrgId = typeof company.linkedOrgId === 'string' ? company.linkedOrgId : undefined
      const name = typeof company.name === 'string' ? company.name : id
      // The linked org is the client's own organisation — the CRM company name
      // is the label users recognise.
      if (!cancelled) setMeta({ name, linkedOrgId, linkedOrgName: linkedOrgId ? name : undefined })
    }
    void load()
    return () => { cancelled = true }
  }, [id])

  if (!id) return null

  async function persist(next: 'shared' | 'private') {
    setError(null)
    const res = await fetch(patchPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientVisibility: next }),
    })
    if (!res.ok) {
      const body = unwrap(await res.json().catch(() => null))
      setError(String(body?.error ?? `Could not update visibility (${res.status})`))
      return
    }
    setValue(next)
  }

  const href = companyHref ?? `/portal/companies/${encodeURIComponent(id)}`

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-pib-line)] bg-white/[0.04] px-2.5 py-1 text-[11px] text-[var(--color-pib-text)] hover:bg-white/[0.08]"
        title="Company-scoped work"
      >
        <span className="text-[var(--color-pib-text-muted)]">Company</span>
        <span className="font-medium">{meta?.name ?? '…'}</span>
      </Link>
      {meta?.linkedOrgId ? (
        <ClientVisibilityToggle
          value={value}
          linkedOrgName={meta.linkedOrgName}
          onChange={persist}
        />
      ) : null}
      {error ? <span className="text-[11px] text-rose-300">{error}</span> : null}
    </div>
  )
}

/** Compact badge for list rows in the org view. */
export function CompanyWorkBadge({ companyName, className = '' }: { companyName: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-[var(--color-pib-line)] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)] ${className}`}
      title="Company-scoped work"
    >
      {companyName}
    </span>
  )
}
