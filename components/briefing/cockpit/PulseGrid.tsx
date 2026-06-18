'use client'

type CountItem = { label: string; value: number; color: string; icon: string }

export function PulseGrid({ counts }: { counts: CountItem[] }) {
  return (
    <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
      {counts.map((item) => (
        <div
          key={item.label}
          className="flex flex-col items-center rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-2 text-center"
        >
          <span className={`text-2xl font-bold leading-none ${item.color}`}>{item.value}</span>
          <span className="mt-1 text-[10px] uppercase tracking-wide text-on-surface-variant">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
