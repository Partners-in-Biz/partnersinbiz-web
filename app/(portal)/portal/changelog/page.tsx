'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'

interface ChangelogRelease {
  id: string
  version: string
  date: string
  title: string
  notes: string[]
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return ((body as { data: T }).data) ?? null
  }
  return (body as T) ?? null
}

function formatDate(value: string): string {
  const t = Date.parse(value)
  if (Number.isNaN(t)) return value
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function ChangelogPage() {
  const [releases, setReleases] = useState<ChangelogRelease[]>([])
  const [lastReadMs, setLastReadMs] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/portal/changelog')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return
        const data = unwrap<{ releases: ChangelogRelease[]; lastReadAt: string | null }>(body)
        if (data?.releases) setReleases(data.releases)
        if (data?.lastReadAt) {
          const t = Date.parse(data.lastReadAt)
          if (!Number.isNaN(t)) setLastReadMs(t)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    // Mark as read on view.
    fetch('/api/v1/portal/changelog', { method: 'POST' }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <p className="eyebrow">What&apos;s new</p>
        <h1 className="pib-page-title">Changelog</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">
          Recent releases, improvements, and fixes across the platform.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="w-5 h-5 border-2 border-[var(--color-pib-accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : releases.length === 0 ? (
        <div className="pib-card p-8 text-center text-[var(--color-pib-text-muted)]">No releases yet.</div>
      ) : (
        <div className="space-y-5">
          {releases.map((release) => {
            const isUnread = Date.parse(release.date) > lastReadMs
            return (
              <article key={release.id} className="pib-card p-5">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="pib-pill">{release.version}</span>
                  <h2 className="text-base font-semibold text-[var(--color-pib-text)]">{release.title}</h2>
                  {isUnread && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]">
                      New
                    </span>
                  )}
                  <span className="ml-auto text-xs text-[var(--color-pib-text-muted)]">{formatDate(release.date)}</span>
                </div>
                <ul className="space-y-1.5">
                  {release.notes.map((note, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-pib-text-muted)]">
                      <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-accent)] mt-0.5">check</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
