'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import { Icon } from '@/components/studio'

type StepKey = 'social' | 'domain' | 'contact' | 'analytics' | 'post'
type ChecklistDone = Record<StepKey, boolean>

interface ChecklistStep {
  key: StepKey
  label: string
  description: string
  href: string
}

interface OnboardingChecklistProps {
  /** Build a portal href scoped to the active org. */
  scopedHref: (path: string) => string
  /** Build an API path scoped to the active org. */
  scopedApi: (path: string) => string
  /** Precomputed flags from /api/v1/portal/dashboard, used to avoid duplicate onboarding probes. */
  initialDone?: ChecklistDone
}

const STORAGE_KEY = 'pib-onboarding-checklist-collapsed'

function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data?: unknown }).data
  }
  return body
}

function metaTotal(body: unknown): number {
  if (body && typeof body === 'object') {
    const meta = (body as { meta?: { total?: unknown } }).meta
    if (meta && typeof meta.total === 'number') return meta.total
    const data = (body as { data?: unknown }).data
    if (Array.isArray(data)) return data.length
  }
  return 0
}

async function fetchJson(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(path)
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  }
}

export function OnboardingChecklist({ scopedHref, scopedApi, initialDone }: OnboardingChecklistProps) {
  const [done, setDone] = useState<ChecklistDone>({
    social: false,
    domain: false,
    contact: false,
    analytics: false,
    post: false,
  })
  const [loaded, setLoaded] = useState(Boolean(initialDone))
  const [collapsed, setCollapsed] = useState(false)

  const steps = useMemo<ChecklistStep[]>(
    () => [
      {
        key: 'social',
        label: 'Connect a social account',
        description: 'Link a platform so you can schedule and publish posts.',
        href: scopedHref('/portal/integrations'),
      },
      {
        key: 'domain',
        label: 'Verify your domain',
        description: 'Point your white-label domain so the portal runs on your URL.',
        href: scopedHref('/portal/settings/domain'),
      },
      {
        key: 'contact',
        label: 'Add a contact',
        description: 'Start building your audience inside the CRM.',
        href: scopedHref('/portal/contacts'),
      },
      {
        key: 'analytics',
        label: 'Install analytics',
        description: 'Connect a property so KPIs flow into your dashboard.',
        href: scopedHref('/portal/properties'),
      },
      {
        key: 'post',
        label: 'Publish a post',
        description: 'Ship your first piece of content to a connected channel.',
        href: scopedHref('/portal/social/compose'),
      },
    ],
    [scopedHref],
  )

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!initialDone) return
    setDone(initialDone)
    setLoaded(true)
  }, [initialDone])

  useEffect(() => {
    if (initialDone) return
    let cancelled = false

    async function run() {
      const [accounts, domain, contacts, dashboard, stats] = await Promise.all([
        fetchJson(scopedApi('/api/v1/social/accounts?limit=1')),
        fetchJson(scopedApi('/api/v1/org/domain')),
        fetchJson(scopedApi('/api/v1/crm/contacts?limit=1')),
        fetchJson(scopedApi('/api/v1/portal/dashboard')),
        fetchJson(scopedApi('/api/v1/social/stats')),
      ])
      if (cancelled) return

      // Social: any connected account
      const accountsData = unwrap(accounts)
      const socialDone = Array.isArray(accountsData)
        ? accountsData.length > 0
        : metaTotal(accounts) > 0

      // Domain: settings.customDomain.verified === true
      const domainData = unwrap(domain) as { domain?: { verified?: boolean } } | null
      const domainDone = domainData?.domain?.verified === true

      // Contact: meta.total > 0
      const contactDone = metaTotal(contacts) > 0

      // Analytics: dashboard connections length > 0
      const dashboardData = unwrap(dashboard) as { connections?: unknown[] } | null
      const analyticsDone = Array.isArray(dashboardData?.connections) && dashboardData!.connections.length > 0

      // Post: byStatus.published > 0
      const statsData = unwrap(stats) as { byStatus?: { published?: number } } | null
      const postDone = (statsData?.byStatus?.published ?? 0) > 0

      setDone({
        social: socialDone,
        domain: domainDone,
        contact: contactDone,
        analytics: analyticsDone,
        post: postDone,
      })
      setLoaded(true)
    }

    run()
    return () => {
      cancelled = true
    }
  }, [scopedApi, initialDone])

  const completedCount = steps.filter((s) => done[s.key]).length
  const allDone = loaded && completedCount === steps.length

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // Don't flash an empty card before the first data load resolves.
  if (!loaded) {
    return <div className="pib-skeleton h-28 rounded-md" aria-hidden />
  }

  if (allDone && collapsed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0" aria-hidden="true">
            <Icon name="task_alt" className="text-[16px]" />
          </span>
          <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">
            You&apos;re all set  -  workspace fully onboarded.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggleCollapse}
          className="shrink-0 text-xs font-label uppercase tracking-wide text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
        >
          Show steps
        </button>
      </div>
    )
  }

  return (
    <div className="pib-card space-y-3" data-module-accent="amber">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            <Icon name="rocket_launch" className="text-[16px]" />
          </span>
          <div className="min-w-0">
            <p className="eyebrow !text-[10px]">Getting started</p>
            <h2 className="mt-0.5 text-lg text-[var(--color-pib-text)]">
              {allDone ? "You're all set" : 'Finish setting up your workspace'}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
              {completedCount} of {steps.length} complete
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div
            className="grid h-9 w-9 place-items-center rounded-md border border-[var(--color-pib-line)] font-mono text-xs text-[var(--color-pib-accent)]"
            aria-label={`${completedCount} of ${steps.length} steps complete`}
          >
            {completedCount}/{steps.length}
          </div>
          {allDone && (
            <button
              type="button"
              onClick={handleToggleCollapse}
              className="text-xs font-label uppercase tracking-wide text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
            >
              Collapse
            </button>
          )}
        </div>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-md bg-[var(--color-pib-line)]">
        <div
          className="h-full rounded-md bg-[var(--color-pib-accent)] transition-all"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <ul className="space-y-0.5">
        {steps.map((step) => {
          const isDone = done[step.key]
          const content = (
            <>
              <Icon
                name={isDone ? 'check_circle' : 'radio_button_unchecked'}
                className={`shrink-0 text-[18px] ${
                  isDone ? 'text-emerald-300' : 'text-[var(--color-pib-text-muted)]'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm font-medium ${
                    isDone
                      ? 'text-[var(--color-pib-text-muted)] line-through'
                      : 'text-[var(--color-pib-text)]'
                  }`}
                >
                  {step.label}
                </span>
                <span className="block text-xs text-[var(--color-pib-text-muted)]">{step.description}</span>
              </span>
              {!isDone && (
                <Icon name="arrow_forward" className="shrink-0 text-[16px] text-[var(--color-pib-text-muted)]" />
              )}
            </>
          )
          return (
            <li key={step.key}>
              {isDone ? (
                <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">{content}</div>
              ) : (
                <Link
                  href={step.href}
                  className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-[var(--color-row-hover)]"
                >
                  {content}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
