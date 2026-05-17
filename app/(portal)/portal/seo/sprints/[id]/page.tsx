import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export default async function PortalProgressTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tasksSnap = await adminDb
    .collection('seo_tasks')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = tasksSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
  const total = tasks.length
  const done = tasks.filter((task) => task.status === 'done').length
  const inFlight = tasks.filter((task) => task.status === 'in_progress')
  const blocked = tasks.filter((task) => task.status === 'blocked')
  const recent = tasks
    .filter((task) => task.status === 'done')
    .sort((a, b) => (b.completedAt?.toMillis?.() ?? 0) - (a.completedAt?.toMillis?.() ?? 0))
    .slice(0, 8)

  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Complete" value={`${done}/${total}`} icon="task_alt" />
        <StatTile label="Progress" value={`${pct}%`} icon="trending_up" />
        <StatTile label="In flight" value={String(inFlight.length)} icon="autorenew" />
        <StatTile label="Blocked" value={String(blocked.length)} icon="block" />
      </section>

      <section className="pib-card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="eyebrow">Sprint progress</p>
            <h2 className="font-headline text-2xl font-semibold mt-2">Work moving through the 90-day plan</h2>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
              Completed tasks, active work, and recent wins from the SEO sprint.
            </p>
          </div>
          <p className="font-display text-4xl tabular-nums">{pct}%</p>
        </div>
        <div className="mt-6 h-3 rounded-full bg-[var(--color-pib-line)] overflow-hidden">
          <div className="h-full rounded-full bg-[var(--color-pib-accent)]" style={{ width: `${pct}%` }} />
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TaskList title={`In flight (${inFlight.length})`} icon="autorenew" tasks={inFlight} empty="Nothing in flight right now." />
        <TaskList title="Recent activity" icon="history" tasks={recent} empty="No completed tasks yet." showDate />
      </section>
    </div>
  )
}

function StatTile({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl">{value}</p>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TaskList({ title, icon, tasks, empty, showDate }: { title: string; icon: string; tasks: any[]; empty: string; showDate?: boolean }) {
  return (
    <div className="pib-card p-5 space-y-4">
      <h3 className="font-headline text-lg font-semibold flex items-center gap-2">
        <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">{icon}</span>
        {title}
      </h3>
      {tasks.length === 0 ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li key={task.id} className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-sm leading-relaxed">{task.title}</p>
                {showDate && (
                  <span className="text-[10px] text-[var(--color-pib-text-muted)] shrink-0">
                    {task.completedAt?.toDate ? new Date(task.completedAt.toDate()).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : ''}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
                Week {task.week ?? '-'} - {task.focus ?? 'SEO'} - {task.taskType ?? 'task'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
