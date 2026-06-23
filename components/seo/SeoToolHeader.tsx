'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { usePathname } from 'next/navigation'

export type SprintOption = { id: string; siteName: string; siteUrl: string }

/**
 * Shared header for top-level SEO tool pages: title, description, optional
 * action slot, and an optional sprint switcher that updates the `sprintId`
 * query param (preserving org scope).
 */
export function SeoToolHeader({
  eyebrow,
  title,
  description,
  sprints,
  activeSprintId,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  sprints?: SprintOption[]
  activeSprintId?: string
  action?: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function switchSprint(id: string) {
    const next = new URLSearchParams(Array.from(params.entries()))
    next.set('sprintId', id)
    router.push(`${pathname}?${next.toString()}`)
  }

  return (
    <header className="flex flex-col gap-4 border-b border-[var(--color-pib-line)] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 font-headline text-2xl font-semibold md:text-3xl">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {sprints && sprints.length > 1 && (
          <select
            value={activeSprintId ?? ''}
            onChange={(e) => switchSprint(e.target.value)}
            className="pib-select !w-auto text-xs"
            aria-label="Active sprint"
          >
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.siteName}
              </option>
            ))}
          </select>
        )}
        {action}
      </div>
    </header>
  )
}
