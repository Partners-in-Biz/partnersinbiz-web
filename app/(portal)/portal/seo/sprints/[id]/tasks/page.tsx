import { adminDb } from '@/lib/firebase/admin'
import { Icon } from '@/components/studio'

export const dynamic = 'force-dynamic'

const STATUS_COLORS: Record<string, string> = {
  not_started: 'pib-pill',
  in_progress: 'pib-pill pib-pill-info',
  blocked: 'pib-pill pib-pill-danger',
  done: 'pib-pill pib-pill-success',
  skipped: 'pib-pill pib-pill-warn',
  na: 'pib-pill',
}

export default async function TasksTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_tasks')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
  tasks.sort((a, b) => a.week - b.week || a.phase - b.phase)

  // Group by week
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byWeek: Record<number, any[]> = {}
  for (const t of tasks) {
    byWeek[t.week] ??= []
    byWeek[t.week].push(t)
  }

  return (
    <div className="space-y-4" data-module-accent="green">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="pib-label mb-2">Sprint ledger</p>
          <h2 className="text-2xl text-[var(--color-pib-text)]">Tasks</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="pib-pill pib-pill-success">{tasks.filter((t) => t.status === 'done').length} done</span>
          <span className="pib-pill pib-pill-info">{tasks.filter((t) => t.status === 'in_progress').length} in flight</span>
          <span className="pib-pill pib-pill-danger">{tasks.filter((t) => t.status === 'blocked').length} blocked</span>
        </div>
      </header>

      {Object.entries(byWeek).map(([week, items]) => (
        <section key={week} className="pib-card-section">
          <div className="pib-card-section-header flex items-center justify-between">
            <div>
              <h3 className="text-sm text-[var(--color-pib-text)]">Week {week}</h3>
              <p className="text-xs text-[var(--color-pib-text-muted)]">{items.length} sprint tasks</p>
            </div>
            <Icon name="view_list" />
          </div>
          <div className="divide-y divide-[var(--color-pib-line)]">
            {items.map((t) => (
              <div key={t.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03] sm:px-5">
                <span className={STATUS_COLORS[t.status] ?? STATUS_COLORS.not_started}>
                  {t.status}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-pib-text)]">{t.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--color-pib-text-muted)]">
                    {t.focus} · {t.taskType}
                    {t.autopilotEligible && ' · autopilot'}
                    {t.source === 'optimization' && ' · optimization'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
