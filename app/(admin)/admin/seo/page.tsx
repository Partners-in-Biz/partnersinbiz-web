import Link from 'next/link'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { SprintCard } from '@/components/seo/SprintCard'
import { PipPresencePill } from '@/components/seo/PipPresencePill'

export const dynamic = 'force-dynamic'

/**
 * Convert any Firestore `Timestamp` instances inside a doc to plain ISO
 * strings, recursively. Required because Server Components cannot pass
 * non-plain class instances to `'use client'` boundaries — Next.js will throw
 * "Only plain objects can be passed from Server to Client Components."
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeForClient(value: any): any {
  if (value === null || value === undefined) return value
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serializeForClient)
  if (typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serializeForClient(v)
    return out
  }
  return value
}

export default async function SeoIndexPage() {
  const snap = await adminDb.collection('seo_sprints').where('deleted', '==', false).get()
  const sprints = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => serializeForClient({ id: d.id, ...(d.data() as any) }))
  // Newest first (createdAt is now an ISO string)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sprints.sort((a: any, b: any) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bt - at
  })

  // Find any sprint's lastPullAt for the presence pill (already a string)
  const lastRun =
    sprints
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((s: any) => s.integrations?.gsc?.lastPullAt)
      .filter(Boolean)
      .sort()
      .pop() ?? null

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="pib-label mb-2">Growth operations</p>
          <h1 className="pib-page-title">SEO Sprints</h1>
          <p className="pib-page-sub max-w-2xl">
            90-day sprints per client site. Daily pulls + weekly optimization loop.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PipPresencePill lastRunAt={lastRun} nowAt={new Date().toISOString()} />
          <Link
            href="/admin/seo/sprints/new"
            className="pib-btn-primary text-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New sprint
          </Link>
          <Link href="/admin/seo/tools" className="pib-btn-secondary text-sm">
            <span className="material-symbols-outlined text-[18px]">construction</span>
            Tools
          </Link>
        </div>
      </header>
      {sprints.length === 0 ? (
        <div className="pib-card py-12 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">travel_explore</span>
          <p className="text-[var(--color-pib-text-muted)] mb-4">No sprints yet.</p>
          <Link
            href="/admin/seo/sprints/new"
            className="pib-btn-primary text-sm"
          >
            Create the first sprint
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {sprints.map((s: any) => (
            <SprintCard key={s.id} sprint={s} />
          ))}
        </div>
      )}
    </div>
  )
}
