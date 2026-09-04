import type { ReactNode } from 'react'

export function PartStatusBox({ children }: { children: ReactNode }) {
  return (
    <div className="my-2 rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-row-hover)] px-3 py-2">
      <p className="text-sm font-medium text-[var(--color-pib-text)]">{children}</p>
    </div>
  )
}
