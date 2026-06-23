'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
  /** The contact currently open — the default winner (record we keep). */
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
    <section className="bento-card !p-5" aria-label={`Merge duplicate for ${contactLabel(contact)}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow !text-[10px]">Data hygiene</p>
          <h2 className="mt-1 font-display text-lg text-[var(--color-pib-text)]">Merge duplicate</h2>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Find and merge a duplicate of ${contactLabel(contact)}`}
            className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">merge</span>
            Merge duplicate
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-sm leading-6 text-[var(--color-pib-text-muted)]">
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
                className="input-pib w-full text-sm"
                aria-label="Search contacts to merge"
                autoComplete="off"
              />
              {searchError && <p className="mt-2 text-xs text-red-400">{searchError}</p>}
              <div className="mt-3">
                {searching ? (
                  <p className="text-xs text-[var(--color-pib-text-muted)]">Searching…</p>
                ) : search.trim().length < 2 ? (
                  <p className="text-xs text-[var(--color-pib-text-muted)]">
                    Type at least 2 characters to search.
                  </p>
                ) : results.length === 0 ? (
                  <p className="text-xs text-[var(--color-pib-text-muted)]">No matching contacts found.</p>
                ) : (
                  <ul className="space-y-2">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => pickDuplicate(c)}
                          aria-label={`Select ${contactLabel(c)} as the duplicate to merge`}
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-[var(--color-pib-accent)]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--color-pib-text)]">
                              {contactLabel(c)}
                            </span>
                            <span className="block truncate text-xs text-[var(--color-pib-text-muted)]">
                              {c.email?.trim() || 'No email'}
                              {c.companyName?.trim() || c.company?.trim()
                                ? ` · ${c.companyName?.trim() || c.company?.trim()}`
                                : ''}
                            </span>
                          </span>
                          <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-accent)]" aria-hidden="true">
                            arrow_forward
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => { reset(); setOpen(false) }}
                  className="btn-pib-secondary text-xs"
                  aria-label="Cancel merge"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {duplicate && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Keep (winner)</p>
                    <p className="mt-1 truncate text-sm font-medium text-[var(--color-pib-text)]">{contactLabel(contact)}</p>
                  </div>
                  <div>
                    <p className="font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Merge away (loser)</p>
                    <p className="mt-1 truncate text-sm font-medium text-[var(--color-pib-text)]">{contactLabel(duplicate)}</p>
                  </div>
                </div>
              </div>

              {conflicts.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  No conflicting fields. The winner keeps its values; any blanks are backfilled from the
                  duplicate, and tags are combined.
                </p>
              ) : (
                <div>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">
                    Choose which value to keep for each conflicting field:
                  </p>
                  <ul className="mt-2 space-y-3">
                    {conflicts.map(({ key, label }) => {
                      const w = fieldValue(contact, key)
                      const l = fieldValue(duplicate, key)
                      const choice = resolutions[key as string] ?? 'winner'
                      return (
                        <li key={key as string} className="rounded-lg border border-[var(--color-pib-line)] p-3">
                          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                            {label}
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setResolutions((prev) => ({ ...prev, [key as string]: 'winner' }))}
                              aria-pressed={choice === 'winner'}
                              aria-label={`Keep ${label} "${w || 'blank'}" from ${contactLabel(contact)}`}
                              className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                                choice === 'winner'
                                  ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]/[0.08] text-[var(--color-pib-text)]'
                                  : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                              }`}
                            >
                              {w || <span className="italic opacity-70">blank</span>}
                            </button>
                            <button
                              type="button"
                              onClick={() => setResolutions((prev) => ({ ...prev, [key as string]: 'loser' }))}
                              aria-pressed={choice === 'loser'}
                              aria-label={`Keep ${label} "${l || 'blank'}" from ${contactLabel(duplicate)}`}
                              className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                                choice === 'loser'
                                  ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]/[0.08] text-[var(--color-pib-text)]'
                                  : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
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

              {mergeError && <p className="text-xs text-red-400">{mergeError}</p>}

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => { setDuplicate(null); setResolutions({}); setMergeError('') }}
                  className="btn-pib-secondary text-xs"
                  aria-label="Choose a different duplicate"
                >
                  Back to search
                </button>
                <button
                  type="button"
                  onClick={confirmMerge}
                  disabled={merging}
                  className="btn-pib-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
                  aria-label={`Confirm merge of ${contactLabel(duplicate)} into ${contactLabel(contact)}`}
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">merge</span>
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
