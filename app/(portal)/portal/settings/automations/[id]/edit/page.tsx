'use client'
export const dynamic = 'force-dynamic'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AutomationRuleForm } from '@/components/crm/AutomationRuleForm'
import type { AutomationRule } from '@/lib/automations/types'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const automationEndpoint = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])
  const automationHref = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])

  const [rule, setRule] = useState<AutomationRule | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const loadRule = useCallback(async (cancelled?: () => boolean) => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(automationEndpoint('/api/v1/crm/automations'))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
        throw new Error(message)
      }
      const rules: AutomationRule[] = body.data?.rules ?? body.data ?? body
      const found = Array.isArray(rules) ? rules.find((r) => r.id === id) : null
      if (!found) throw new Error('Automation rule not found.')
      if (!cancelled?.()) setRule(found)
    } catch (err: unknown) {
      if (!cancelled?.()) setFetchError(err instanceof Error ? err.message : 'Failed to load rule.')
    } finally {
      if (!cancelled?.()) setLoading(false)
    }
  }, [automationEndpoint, id])

  useEffect(() => {
    let cancelled = false

    void loadRule(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [id, loadRule])

  function handleSave() {
    router.push(automationHref('/portal/settings/automations'))
  }

  function handleCancel() {
    router.push(automationHref('/portal/settings/automations'))
  }

  return (
    <div className="max-w-6xl space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <button
            type="button"
            onClick={handleCancel}
            className="mb-4 flex cursor-pointer items-center gap-1 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">arrow_back</span>
            Automations
          </button>
          <p className="eyebrow">Settings · Rule builder</p>
          <h1 className="pib-page-title mt-2">Edit automation</h1>
          <p className="pib-page-sub max-w-2xl">
            Tune the trigger, timing, and execution chain without breaking the rule&apos;s operational intent.
          </p>
        </div>
        {rule && (
          <div className="pib-card w-full max-w-sm">
            <p className="text-xs font-medium">{rule.enabled ? 'Currently live' : 'Currently paused'}</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              {rule.actions.length} action{rule.actions.length === 1 ? '' : 's'} configured for this automation.
            </p>
          </div>
        )}
      </header>

      {loading ? (
        <div className="pib-card space-y-3">
          <div className="pib-skeleton h-4 w-1/3" />
          <div className="pib-skeleton h-4 w-2/3" />
          <div className="pib-skeleton h-4 w-1/2" />
        </div>
      ) : fetchError ? (
        <section className="pib-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <span className="pib-icon-tint mt-0.5 shrink-0">
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">warning</span>
              </span>
              <div>
                <p className="eyebrow">Source health</p>
                <h2 className="mt-1 font-display text-xl">
                  Automation rule could not load
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{fetchError}</p>
                <p className="mt-3 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  Trigger, timing, and action controls stay hidden until the automation source responds, so teams do not change workflow rules from stale or partial data.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadRule()}
                aria-label="Retry loading automation rule"
                className="btn-pib-secondary"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
                Retry
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="btn-pib-ghost"
              >
                Back to automations
              </button>
            </div>
          </div>
        </section>
      ) : rule ? (
        <AutomationRuleForm
          initial={rule}
          endpoint={automationEndpoint(`/api/v1/crm/automations/${rule.id}`)}
          sequencesEndpoint={automationEndpoint('/api/v1/crm/sequences')}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      ) : null}
    </div>
  )
}
