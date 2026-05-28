'use client'
export const dynamic = 'force-dynamic'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AutomationRuleForm } from '@/components/crm/AutomationRuleForm'
import type { AutomationRule } from '@/lib/automations/types'

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()

  const [rule, setRule] = useState<AutomationRule | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadRule() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch('/api/v1/crm/automations')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        const rules: AutomationRule[] = body.data?.rules ?? body.data ?? body
        const found = Array.isArray(rules) ? rules.find((r) => r.id === id) : null
        if (!found) throw new Error('Automation rule not found.')
        if (!cancelled) setRule(found)
      } catch (err: unknown) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : 'Failed to load rule.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadRule()
    return () => {
      cancelled = true
    }
  }, [id])

  function handleSave() {
    router.push('/portal/settings/automations')
  }

  function handleCancel() {
    router.push('/portal/settings/automations')
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <button
            type="button"
            onClick={handleCancel}
            className="cursor-pointer flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] mb-4 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            Automations
          </button>
          <p className="eyebrow !text-[10px]">Rule builder</p>
          <h1 className="pib-page-title mt-2">Edit automation</h1>
          <p className="pib-page-sub max-w-2xl">
            Tune the trigger, timing, and execution chain without breaking the rule&apos;s operational intent.
          </p>
        </div>
        {rule && (
          <div className="bento-card !p-4 w-full max-w-sm">
            <p className="text-xs font-medium">{rule.enabled ? 'Currently live' : 'Currently paused'}</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              {rule.actions.length} action{rule.actions.length === 1 ? '' : 's'} configured for this automation.
            </p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="bento-card !p-6">
          <p className="text-sm text-[var(--color-pib-text-muted)]">Loading rule…</p>
        </div>
      ) : fetchError ? (
        <div className="bento-card !p-6 flex items-start gap-2">
          <span className="material-symbols-outlined text-[16px] text-red-400 mt-0.5">error</span>
          <div>
            <p className="text-sm text-red-400">{fetchError}</p>
            <button
              type="button"
              onClick={handleCancel}
              className="cursor-pointer mt-3 btn-pib-secondary text-sm"
            >
              Back to automations
            </button>
          </div>
        </div>
      ) : rule ? (
        <AutomationRuleForm initial={rule} onSave={handleSave} onCancel={handleCancel} />
      ) : null}
    </div>
  )
}
