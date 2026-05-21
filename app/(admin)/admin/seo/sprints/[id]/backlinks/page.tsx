import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  not_started: 'pib-pill',
  submitted: 'pib-pill pib-pill-info',
  live: 'pib-pill pib-pill-success',
  rejected: 'pib-pill pib-pill-danger',
  lost: 'pib-pill pib-pill-warn',
}

export default async function BacklinksTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_backlinks')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const links = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))

  // Group by type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups: Record<string, any[]> = {}
  for (const l of links) {
    groups[l.type] ??= []
    groups[l.type].push(l)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="pib-label mb-2">Authority pipeline</p>
          <h2 className="text-2xl font-semibold text-[var(--color-pib-text)]">Backlinks</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="pib-pill">{links.length} total</span>
          <span className="pib-pill pib-pill-success">{links.filter((l) => l.status === 'live').length} live</span>
          <span className="pib-pill pib-pill-info">{links.filter((l) => l.status === 'submitted').length} submitted</span>
        </div>
      </header>

      {Object.entries(groups).map(([type, items]) => (
        <section key={type} className="pib-card-section">
          <div className="pib-card-section-header flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold capitalize text-[var(--color-pib-text)]">
                {type.replace('_', ' ')}
              </h3>
              <p className="text-xs text-[var(--color-pib-text-muted)]">{items.length} opportunities</p>
            </div>
            <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">hub</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                <tr>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Domain</th>
                  <th className="px-4 py-3">DR</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Live</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-pib-line)]">
                {items.map((l) => (
                  <tr key={l.id} className="transition-colors hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-medium text-[var(--color-pib-text)]">{l.source}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-pib-text-muted)]">{l.domain}</td>
                    <td className="px-4 py-3">{l.theirDR ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={STATUS_PILL[l.status] ?? 'pib-pill'}>{l.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">{l.submittedAt ? new Date(l.submittedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-xs">{l.liveAt ? new Date(l.liveAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
