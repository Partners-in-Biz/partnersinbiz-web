'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/studio'

export interface MergeCandidateContact {
  id: string
  name?: string
  email?: string
  phone?: string
  company?: string
  companyName?: string
  jobTitle?: string
  stage?: string
  type?: string
  [key: string]: unknown
}

interface ContactMergePanelProps {
  /** The contact currently open - the default winner (record we keep). */
  contact: MergeCandidateContact
  apiPath: (path: string) => string
  /** Called after a successful merge so the page can refresh. */
  onMerged?: (winnerId: string, loserId: string) => void
}

/** Fields surfaced for side-by-side conflict resolution. */
const CONFLICT_FIELDS: { key: keyof MergeCandidateContact; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'jobTitle', label: 'Job title' },
  { key: 'company', label: 'Company' },
  { key: 'stage', label: 'Stage' },
  { key: 'type', label: 'Type' },
]

function fieldValue(contact: MergeCandidateContact, key: keyof MergeCandidateContact): string {
  const raw = contact[key]
  if (key === 'company') {
    const v = contact.companyName ?? contact.company
    return typeof v === 'string' ? v.trim() : ''
  }
  return typeof raw === 'string' ? raw.trim() : ''
}

function contactLabel(contact: MergeCandidateContact): string {
  return contact.name?.trim() || contact.email?.trim() || 'Unnamed contact'
}

export function ContactMergePanel({ contact, apiPath, onMerged }: ContactMergePanelProps) {
  const [open, setOpen] = useState(false)

  const [search, setSearch] = useState('')
  const [results, setResults] = useState<MergeCandidateContact[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [duplicate, setDuplicate] = useState<MergeCandidateContact | null>(null)
  // Per conflicting field: 'winner' keeps the open contact's value, 'loser' takes the duplicate's.
  const [resolutions, setResolutions] = useState<Record<string, 'winner' | 'loser'>>({})

  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(
    async (term: string) => {
      const q = term.trim()
      if (q.length < 2) {
        setResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      setSearchError('')
      try {
        const r = await fetch(apiPath(`/api/v1/crm/contacts?search=${encodeURIComponent(q)}&limit=10`))
        const b = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(typeof b?.error === 'string' ? b.error : `HTTP ${r.status}`)
        const list = (Array.isArray(b.data) ? b.data : b.data?.contacts ?? []) as MergeCandidateContact[]
        // Never offer the open contact as its own duplicate.
        setResults(list.filter((c) => c.id !== contact.id))
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Search failed')
        setResults([])
      } finally {
        setSearching(false)
      }
    },
    [apiPath, contact.id],
  )

  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(search), 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, open, runSearch])

  function pickDuplicate(candidate: MergeCandidateContact) {
    setDuplicate(candidate)
    // Default every conflict to keep the winner (open contact) value.
    const init: Record<string, 'winner' | 'loser'> = {}
    for (const { key } of CONFLICT_FIELDS) {
      const w = fieldValue(contact, key)
      const l = fieldValue(candidate, key)
      if (w !== l && (w || l)) init[key as string] = w ? 'winner' : 'loser'
    }
    setResolutions(init)
    setMergeError('')
  }

  function reset() {
    setDuplicate(null)
    setResolutions({})
    setSearch('')
    setResults([])
    setMergeError('')
  }

  async function confirmMerge() {
    if (!duplicate) return
    setMerging(true)
    setMergeError('')
    try {
      // Conflict resolution: the merge API keeps the winner's non-null fields by
      // default. For any conflict the user resolved to the DUPLICATE's value, we
      // first patch the winner with that value so the merge preserves the choice.
      const winnerPatch: Record<string, unknown> = {}
      for (const { key } of CONFLICT_FIELDS) {
        if (key === 'company') continue // company is resolved via companyId elsewhere
        if (resolutions[key as string] === 'loser') {
          const v = fieldValue(duplicate, key)
          if (v) winnerPatch[key as string] = v
        }
      }

      if (Object.keys(winnerPatch).length > 0) {
        const pr = await fetch(apiPath(`/api/v1/crm/contacts/${contact.id}`), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(winnerPatch),
        })
        if (!pr.ok) {
          const pb = await pr.json().catch(() => ({}))
          throw new Error(typeof pb?.error === 'string' ? pb.error : 'Failed to apply field choices')
        }
      }

      const r = await fetch(apiPath('/api/v1/crm/contacts/merge'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          winnerId: contact.id,
          loserId: duplicate.id,
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(typeof b?.error === 'string' ? b.error : 'Merge failed')
      const loserId = duplicate.id
      reset()
      setOpen(false)
      onMerged?.(contact.id, loserId)
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setMerging(false)
    }
  }

  const conflicts = duplicate
    ? CONFLICT_FIELDS.filter(({ key }) => {
        const w = fieldValue(contact, key)
        const l = fieldValue(duplicate, key)
        return w !== l && (w || l)
      })
    : []

  return (
    <section className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3" aria-label={`Merge duplicate for ${contactLabel(contact)}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Data hygiene</p>
          <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Merge duplicate</h2>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Find and merge a duplicate of ${contactLabel(contact)}`}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <Icon name="merge" className="text-[14px]" />
            Merge duplicate
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
            Search for another contact in this workspace that is the same person. The current contact
            ({contactLabel(contact)}) is kept; the duplicate is merged away.
          </p>

          {!duplicate && (
            <div>
              <label htmlFor="merge-search" className="sr-only">Search contacts to merge</label>
              <input
                id="merge-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]"
                aria-label="Search contacts to merge"
                autoComplete="off"
              />
              {searchError && <p className="mt-2 text-xs text-red-300">{searchError}</p>}
              <div className="mt-2">
                {searching ? (
                  <p className="text-xs text-[var(--color-pib-text-muted)]">Searching…</p>
                ) : search.trim().length < 2 ? (
                  <p className="text-xs text-[var(--color-pib-text-muted)]">
                    Type at least 2 characters to search.
                  </p>
                ) : results.length === 0 ? (
                  <p className="text-xs text-[var(--color-pib-text-muted)]">No matching contacts found.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => pickDuplicate(c)}
                          aria-label={`Select ${contactLabel(c)} as the duplicate to merge`}
                          className="flex w-full items-center justify-between gap-3 rounded-md border border-[var(--color-card-border)] px-2 py-1.5 text-left transition hover:bg-white/[0.04]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-[var(--color-pib-text)]">
                              {contactLabel(c)}
                            </span>
                            <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">
                              {c.email?.trim() || 'No email'}
                              {c.companyName?.trim() || c.company?.trim()
                                ? ` · ${c.companyName?.trim() || c.company?.trim()}`
                                : ''}
                            </span>
                          </span>
                          <Icon name="arrow_forward" className="text-[16px] text-primary" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => { reset(); setOpen(false) }}
                  className="flex h-8 items-center rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                  aria-label="Cancel merge"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {duplicate && (
            <div className="space-y-3">
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 p-2">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Keep (winner)</p>
                    <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-pib-text)]">{contactLabel(contact)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Merge away (loser)</p>
                    <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-pib-text)]">{contactLabel(duplicate)}</p>
                  </div>
                </div>
              </div>

              {conflicts.length === 0 ? (
                <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  No conflicting fields. The winner keeps its values; any blanks are backfilled from the
                  duplicate, and tags are combined.
                </p>
              ) : (
                <div>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">
                    Choose which value to keep for each conflicting field:
                  </p>
                  <ul className="mt-2 space-y-2">
                    {conflicts.map(({ key, label }) => {
                      const w = fieldValue(contact, key)
                      const l = fieldValue(duplicate, key)
                      const choice = resolutions[key as string] ?? 'winner'
                      return (
                        <li key={key as string} className="rounded-md border border-[var(--color-card-border)] p-2">
                          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">
                            {label}
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setResolutions((prev) => ({ ...prev, [key as string]: 'winner' }))}
                              aria-pressed={choice === 'winner'}
                              aria-label={`Keep ${label} "${w || 'blank'}" from ${contactLabel(contact)}`}
                              className={`rounded-md border px-2 py-1.5 text-left text-xs transition ${
                                choice === 'winner'
                                  ? 'border-primary/30 bg-primary/10 text-primary'
                                  : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                              }`}
                            >
                              {w || <span className="italic opacity-70">blank</span>}
                            </button>
                            <button
                              type="button"
                              onClick={() => setResolutions((prev) => ({ ...prev, [key as string]: 'loser' }))}
                              aria-pressed={choice === 'loser'}
                              aria-label={`Keep ${label} "${l || 'blank'}" from ${contactLabel(duplicate)}`}
                              className={`rounded-md border px-2 py-1.5 text-left text-xs transition ${
                                choice === 'loser'
                                  ? 'border-primary/30 bg-primary/10 text-primary'
                                  : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                              }`}
                            >
                              {l || <span className="italic opacity-70">blank</span>}
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {mergeError && <p className="text-xs text-red-300">{mergeError}</p>}

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => { setDuplicate(null); setResolutions({}); setMergeError('') }}
                  className="flex h-8 items-center rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                  aria-label="Choose a different duplicate"
                >
                  Back to search
                </button>
                <button
                  type="button"
                  onClick={confirmMerge}
                  disabled={merging}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:opacity-50"
                  aria-label={`Confirm merge of ${contactLabel(duplicate)} into ${contactLabel(contact)}`}
                >
                  <Icon name="merge" className="text-[14px]" />
                  {merging ? 'Merging…' : 'Merge contacts'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
