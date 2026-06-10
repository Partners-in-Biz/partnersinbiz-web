import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  proposed: 'pib-pill pib-pill-info',
  approved: 'pib-pill pib-pill-accent',
  in_progress: 'pib-pill pib-pill-warn',
  applied: 'pib-pill pib-pill-info',
  rejected: 'pib-pill',
  measured: 'pib-pill pib-pill-success',
}

const RESULT_PILL: Record<string, string> = {
  win: 'pib-pill pib-pill-success',
  'no-change': 'pib-pill',
  loss: 'pib-pill pib-pill-danger',
}

export default async function OptimizationsTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_optimizations')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
  opts.sort((a, b) => (b.detectedAt ?? '').localeCompare(a.detectedAt ?? ''))

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="pib-label mb-2">Autoresearch loop</p>
          <h2 className="text-2xl font-semibold text-[var(--color-pib-text)]">Optimizations</h2>
        </div>
        <form action={`/api/v1/seo/sprints/${id}/optimize`} method="POST">
          <button className="pib-btn-secondary text-sm">
            <span className="material-symbols-outlined text-[18px]">psychology</span>
            Run optimization loop
          </button>
        </form>
      </header>
      {opts.length === 0 ? (
        <div className="pib-card py-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined mb-2 block text-3xl">tips_and_updates</span>
          No optimization proposals yet. The weekly cron generates these on Mondays based on sprint health.
        </div>
      ) : (
        <ul className="space-y-3">
          {opts.map((o) => (
            <li key={o.id} className="pib-card space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-medium text-[var(--color-pib-text)]">{o.hypothesis}</div>
                  <div className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                    {o.signal?.type} · severity {o.signal?.severity}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <span className={STATUS_PILL[o.status] ?? 'pib-pill'}>{o.status}</span>
                  {o.result && (
                    <span className={RESULT_PILL[o.result] ?? 'pib-pill'}>{o.result}</span>
                  )}
                </div>
              </div>
              <p className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3 text-xs text-[var(--color-pib-text-muted)]">{o.proposedAction}</p>
              {o.outcomeDelta && (
                <p className="text-xs">
                  Outcome: position {o.outcomeDelta.positionChange?.toFixed(1) ?? '—'} · impressions{' '}
                  {o.outcomeDelta.impressionsChange ?? '—'}
                </p>
              )}
              {o.status === 'proposed' && (
                <div className="flex gap-2 pt-2">
                  <form action={`/api/v1/seo/optimizations/${o.id}/approve`} method="POST">
                    <button className="pib-btn-primary !px-3 !py-1.5 text-xs">
                      <span className="material-symbols-outlined text-base">check</span>
                      Approve
                    </button>
                  </form>
                  <form action={`/api/v1/seo/optimizations/${o.id}/reject`} method="POST">
                    <button className="pib-btn-secondary !px-3 !py-1.5 text-xs">Reject</button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
