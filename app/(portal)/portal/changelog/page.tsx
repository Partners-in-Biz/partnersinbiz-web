'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import { Icon, Panel, Skeleton, Status } from '@/components/studio'

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

    fetch('/api/v1/portal/changelog', { method: 'POST' }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        eyebrow="What is new"
        title="Changelog."
        description="Recent releases, improvements, and fixes across the platform."
      />

      {loading ? (
        <div className="flex flex-col gap-4 py-8" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : releases.length === 0 ? (
        <EmptyState title="No releases yet." description="New platform updates will appear here when published." />
      ) : (
        <div className="space-y-8">
          {releases.map((release) => {
            const isUnread = Date.parse(release.date) > lastReadMs
            return (
              <Panel key={release.id} className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Status tone="info">{release.version}</Status>
                  <h2 className="st-title text-[var(--sc-ink)]">{release.title}</h2>
                  {isUnread ? <Status tone="info">New</Status> : null}
                  <span className="sc-tiny ml-auto text-[var(--sc-ink-soft)]">{formatDate(release.date)}</span>
                </div>
                <ul className="space-y-2">
                  {release.notes.map((note, i) => (
                    <li key={i} className="sc-body flex items-start gap-2 text-[var(--sc-ink-soft)]">
                      <Icon name="check" className="mt-0.5 shrink-0" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )
          })}
        </div>
      )}
    </div>
  )
}
