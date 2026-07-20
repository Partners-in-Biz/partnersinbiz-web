'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { usePathname } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'

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
    <PageHeader
      accent="green"
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={
        <>
          {sprints && sprints.length > 1 && (
            <select
              value={activeSprintId ?? ''}
              onChange={(e) => switchSprint(e.target.value)}
              className="pib-select h-7 !w-auto text-xs"
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
        </>
      }
    />
  )
}
