import type { ReactNode } from 'react'

type AdminOperatorGateProps = {
  title?: string
  body?: string
  items?: string[]
  actions?: ReactNode
}

const DEFAULT_ITEMS = [
  'Prepare drafts, review evidence, and route work through Projects/Kanban before client-visible release.',
  'Publishing, messaging, scheduling, paid launch, and public/client-visible actions stay locked until approval is recorded.',
  'Keep source org, task, reviewer, risk, and expected artifacts attached to the implementation handoff.',
]

export function AdminOperatorGate({
  title = 'Operator workflow and approval gate',
  body = 'This admin surface is for PiB operators. It is not a client self-service portal, and it must not bypass approval gates for public or client-visible actions.',
  items = DEFAULT_ITEMS,
  actions,
}: AdminOperatorGateProps) {
  return (
    <section className="pib-card border-amber-400/30 bg-amber-400/10 p-4 text-sm text-[var(--color-pib-text)]" aria-label={title}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="eyebrow !text-[10px] text-amber-700">Admin-only safety boundary</p>
          <h2 className="mt-1 font-headline text-lg font-semibold">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--color-pib-text-muted)]">{body}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <ul className="mt-3 grid gap-2 text-xs text-[var(--color-pib-text-muted)] md:grid-cols-3">
        {items.map((item) => (
          <li key={item} className="rounded-xl border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-muted)] p-3">
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}
