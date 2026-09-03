'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/studio'

export type ContactFactBand = 'VERIFIED' | 'PROBABLE' | 'POSSIBLE'
export type ContactFactStatus = 'APPLIED' | 'PROPOSED' | 'DISMISSED' | 'SUPERSEDED'

export interface ContactFactEvidence {
  kind: string
  detail: string
  sourceUrl?: string
}

export interface ContactFactRow {
  id: string
  field: string
  value: string
  band: ContactFactBand
  status: ContactFactStatus
  score: number
  rationale: string
  evidence: ContactFactEvidence[]
  method?: string
  sourceUrl?: string | null
}

function bandTone(band: ContactFactBand): string {
  if (band === 'VERIFIED') return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
  if (band === 'PROBABLE') return 'text-[var(--st-warning)] border-amber-500/30 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)]'
  return 'text-[var(--color-pib-text-muted)] border-[var(--color-pib-line)] bg-black/10'
}

function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    name: 'Name',
    title: 'Job title',
    department: 'Department',
    phone: 'Phone',
    linkedinUrl: 'LinkedIn',
    website: 'Website',
    twitterUrl: 'Twitter/X',
    githubUrl: 'GitHub',
    employer: 'Employer',
    seniority: 'Seniority',
    function: 'Function',
    location: 'Location',
    tenure: 'Tenure',
  }
  return map[field] || field
}

export function ContactFactProposalsPanel({
  contactId,
  contactName,
  apiPath,
  onApplied,
}: {
  contactId: string
  contactName: string
  /** Build a scoped API path, e.g. (p) => contactApiPath(p) */
  apiPath: (path: string) => string
  onApplied?: () => void
}) {
  const [facts, setFacts] = useState<ContactFactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showApplied, setShowApplied] = useState(false)

  const load = useCallback(async () => {
    if (!contactId) return
    setLoading(true)
    setError(null)
    try {
      const status = showApplied ? 'PROPOSED,APPLIED' : 'PROPOSED'
      const res = await fetch(
        apiPath(`/api/v1/crm/contacts/${contactId}/facts?status=${encodeURIComponent(status)}&limit=50`),
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error || 'Failed to load proposals')
        setFacts([])
        return
      }
      const rows = (body?.data?.facts ?? body?.facts ?? []) as ContactFactRow[]
      setFacts(Array.isArray(rows) ? rows.filter((f) => f.band !== 'POSSIBLE' || f.status === 'APPLIED') : [])
    } catch {
      setError('Failed to load proposals')
      setFacts([])
    } finally {
      setLoading(false)
    }
  }, [apiPath, contactId, showApplied])

  useEffect(() => {
    void load()
  }, [load])

  async function decide(factId: string, decision: 'accept' | 'dismiss') {
    setBusyId(factId)
    setError(null)
    try {
      const res = await fetch(
        apiPath(`/api/v1/crm/contacts/${contactId}/facts/${factId}/decide`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      )
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error || `Could not ${decision} proposal`)
        return
      }
      setFacts((prev) => prev.filter((f) => f.id !== factId))
      if (decision === 'accept') onApplied?.()
      await load()
    } catch {
      setError(`Could not ${decision} proposal`)
    } finally {
      setBusyId(null)
    }
  }

  const proposed = facts.filter((f) => f.status === 'PROPOSED')
  const applied = facts.filter((f) => f.status === 'APPLIED')

  return (
    <section
      aria-label={`Agent proposals for ${contactName}`}
      className="overflow-hidden rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-pib-line)] px-5 py-3.5">
        <div>
          <p className="eyebrow !text-[10px]">Evidence ledger</p>
          <h3 className="mt-0.5 text-sm font-medium text-[var(--color-pib-text)]">
            Agent proposals
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowApplied((v) => !v)}
            className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]"
          >
            {showApplied ? 'Hide applied' : 'Show applied'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh agent proposals"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]"
          >
            <Icon name="refresh" className="text-[16px]" />
          </button>
        </div>
      </div>

      {error && (
        <p className="border-b border-red-500/20 bg-red-500/10 px-5 py-2 text-xs text-red-200">{error}</p>
      )}

      {loading ? (
        <div className="space-y-2 p-5">
          {[0, 1].map((i) => (
            <div key={i} className="pib-skeleton h-16" />
          ))}
        </div>
      ) : proposed.length === 0 && applied.length === 0 ? (
        <div className="p-5 text-center">
          <Icon name="fact_check" className="text-[22px] text-[var(--color-pib-text-muted)]" />
          <p className="mt-2 text-sm font-medium text-[var(--color-pib-text)]">No open proposals</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--color-pib-text-muted)]">
            When agents record mailbox or research observations, proposed field updates appear here with evidence. Accept writes them; dismiss prevents re-proposal.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-pib-line)]">
          {proposed.map((fact) => (
            <article key={fact.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                      {fieldLabel(fact.field)}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${bandTone(fact.band)}`}>
                      {fact.band}
                    </span>
                    <span className="text-[10px] text-[var(--color-pib-text-muted)]">
                      score {(fact.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-[var(--color-pib-text)]">{fact.value}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{fact.rationale}</p>
                  {fact.evidence?.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {fact.evidence.slice(0, 3).map((ev, idx) => (
                        <li key={`${fact.id}-ev-${idx}`} className="text-[11px] text-[var(--color-pib-text-muted)]">
                          <span className="font-mono text-[10px] text-[var(--color-pib-text)]">{ev.kind}</span>
                          {' - '}
                          {ev.detail}
                          {ev.sourceUrl ? (
                            <>
                              {' '}
                              <a
                                href={ev.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[var(--color-accent-v2)] underline-offset-2 hover:underline"
                              >
                                source
                              </a>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === fact.id}
                    onClick={() => void decide(fact.id, 'dismiss')}
                    aria-label={`Dismiss proposal ${fieldLabel(fact.field)} ${fact.value}`}
                    className="inline-flex h-8 items-center rounded-md border border-[var(--color-pib-line)] px-2.5 text-xs text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    disabled={busyId === fact.id}
                    onClick={() => void decide(fact.id, 'accept')}
                    aria-label={`Accept proposal ${fieldLabel(fact.field)} ${fact.value}`}
                    className="inline-flex h-8 items-center rounded-md bg-[var(--color-accent-v2)] px-2.5 text-xs font-medium text-black disabled:opacity-50"
                  >
                    Accept
                  </button>
                </div>
              </div>
            </article>
          ))}

          {showApplied &&
            applied.map((fact) => (
              <article key={fact.id} className="px-5 py-3 opacity-80">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                    {fieldLabel(fact.field)}
                  </span>
                  <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
                    APPLIED
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--color-pib-text)]">{fact.value}</p>
              </article>
            ))}
        </div>
      )}
    </section>
  )
}
