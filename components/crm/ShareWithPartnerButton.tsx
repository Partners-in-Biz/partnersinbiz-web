'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { scopedApiPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { Icon } from '@/components/studio'

/**
 * Drop-in "share this record with a linked partner" control, for use on the
 * record's own page (project, deal, invoice, quote, client document) so sharing
 * doesn't have to start from /portal/partners.
 *
 * Only lists partner links whose sharedCapabilities already cover this record
 * type - the same gate the API enforces - so the reason a partner is missing is
 * visible here rather than surfacing as a server error on submit.
 */

export type ShareResourceType = 'deal' | 'project' | 'invoice' | 'quote' | 'client_document'

const RESOURCE_CAPABILITY: Record<ShareResourceType, string> = {
  deal: 'crm',
  project: 'projects',
  invoice: 'invoices',
  quote: 'invoices',
  client_document: 'documents',
}

interface PartnerLink {
  relationshipId: string
  status: string
  partnerOrgId?: string
  partnerOrgName?: string
  companyName?: string
  sharedCapabilities: string[]
}

interface ExistingShare {
  id: string
  relationshipId: string
  resourceType: string
  resourceId: string
  permission: string
  status: string
}

export interface ShareWithPartnerButtonProps {
  resourceType: ShareResourceType
  resourceId: string
  /** Optional label override for the trigger. */
  label?: string
  className?: string
  /**
   * Required on admin surfaces (and anywhere the viewed org differs from the
   * caller's active workspace). Without it the API resolves the caller's own
   * active org, which on an admin screen is the wrong tenant.
   */
  orgScope?: PortalOrgRouteScope
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

export function ShareWithPartnerButton({
  resourceType, resourceId, label = 'Share with partner', className = '', orgScope,
}: ShareWithPartnerButtonProps) {
  const scope = orgScope ?? {}
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<PartnerLink[]>([])
  const [shares, setShares] = useState<ExistingShare[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [permission, setPermission] = useState<'view' | 'comment'>('view')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [linkRes, shareRes] = await Promise.all([
        fetch(scopedApiPath('/api/v1/crm/partner-links', scope)),
        fetch(scopedApiPath('/api/v1/crm/partner-shares?direction=outgoing', scope)),
      ])
      const linkData = unwrap(await linkRes.json().catch(() => null))
      const shareData = unwrap(await shareRes.json().catch(() => null))
      if (!linkRes.ok) {
        setError((linkData?.error as string) || 'Could not load partners.')
        return
      }
      setLinks(((linkData?.links as PartnerLink[]) ?? []).filter((l) => l.status === 'active'))
      setShares(((shareData?.outgoing as ExistingShare[]) ?? [])
        .filter((s) => s.resourceType === resourceType && s.resourceId === resourceId))
    } catch {
      setError('Could not load partners.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType, resourceId, orgScope])

  useEffect(() => { if (open) void load() }, [open, load])

  async function share(link: PartnerLink) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(scopedApiPath('/api/v1/crm/partner-shares', scope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relationshipId: link.relationshipId, resourceType, resourceId, permission }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not share this record.')
        return
      }
      setNotice(`Shared with ${link.partnerOrgName || link.companyName || 'partner'}.`)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function unshare(shareId: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(scopedApiPath(`/api/v1/crm/partner-shares/${shareId}`, scope), { method: 'DELETE' })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not stop sharing.')
        return
      }
      setNotice('Stopped sharing.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const capability = RESOURCE_CAPABILITY[resourceType]
  const eligible = links.filter((l) => l.sharedCapabilities?.includes(capability))
  const ineligible = links.filter((l) => !l.sharedCapabilities?.includes(capability))
  const sharedWith = new Set(shares.filter((s) => s.status === 'active').map((s) => s.relationshipId))

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label} - ${resourceType.replace('_', ' ')}`}
        className={className || 'btn-pib-secondary inline-flex items-center gap-1.5'}
      >
        <Icon name="handshake" className="text-[16px]" />
        {label}
        {sharedWith.size > 0 ? (
          <span className="pib-pill pib-pill-info px-1.5 py-0 text-[10px]">{sharedWith.size}</span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3">
          {loading ? (
            <p className="text-xs text-[var(--color-pib-text-muted)]">Loading partners…</p>
          ) : links.length === 0 ? (
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              No linked partners yet. Link a workspace from the Partners page first.
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Access</span>
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as 'view' | 'comment')}
                  aria-label="Access level for new shares"
                  className="rounded border border-[var(--color-pib-line)] bg-black/30 px-1.5 py-0.5 text-[11px] text-[var(--color-pib-text)]"
                >
                  <option value="view">View only</option>
                  <option value="comment">Can comment</option>
                </select>
              </div>

              <ul className="space-y-1.5">
                {eligible.map((link) => {
                  const existing = shares.find((s) => s.relationshipId === link.relationshipId && s.status === 'active')
                  return (
                    <li key={link.relationshipId} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-pib-text)]">
                        {link.partnerOrgName || link.companyName || 'Partner'}
                      </span>
                      {existing ? (
                        <button
                          type="button"
                          onClick={() => void unshare(existing.id)}
                          disabled={busy}
                          className="text-[11px] text-[var(--color-pib-text-muted)] transition hover:text-rose-300 disabled:opacity-50"
                        >
                          Shared · stop
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void share(link)}
                          disabled={busy}
                          className="rounded bg-[var(--color-accent-v2)] px-2 py-0.5 text-[11px] font-medium text-black disabled:opacity-50"
                        >
                          Share
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>

              {ineligible.length > 0 ? (
                <p className="mt-2 border-t border-[var(--color-pib-line)] pt-2 text-[10px] leading-4 text-[var(--color-pib-text-muted)]">
                  {ineligible.length} partner{ineligible.length === 1 ? '' : 's'} hidden - your link with them
                  doesn&rsquo;t share <strong>{capability}</strong>. Enable it on the Partners page.
                </p>
              ) : null}
            </>
          )}

          {error ? <p className="mt-2 text-[11px] text-rose-300">{error}</p> : null}
          {notice ? <p className="mt-2 text-[11px] text-emerald-300">{notice}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
