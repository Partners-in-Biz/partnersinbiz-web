'use client'

type CountItem = { label: string; value: number; color: string; icon: string }

export function PulseGrid({ counts }: { counts: CountItem[] }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {counts.map((item) => (
        <div
          key={item.label}
          className="flex flex-col items-center rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-card)] p-2 text-center"
        >
          <span className={`text-2xl  leading-none ${item.color}`}>{item.value}</span>
          <span className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
