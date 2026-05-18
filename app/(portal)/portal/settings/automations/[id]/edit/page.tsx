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
    setLoading(true)
    setFetchError(null)

    fetch('/api/v1/crm/automations')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        const rules: AutomationRule[] = body.data ?? body
        const found = Array.isArray(rules) ? rules.find((r) => r.id === id) : null
        if (!found) throw new Error('Automation rule not found.')
        setRule(found)
      })
      .catch((err: unknown) => {
        setFetchError(err instanceof Error ? err.message : 'Failed to load rule.')
      })
      .finally(() => setLoading(false))
  }, [id])

  function handleSave(_updated: AutomationRule) {
    router.push('/portal/settings/automations')
  }

  function handleCancel() {
    router.push('/portal/settings/automations')
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <button
          type="button"
          onClick={handleCancel}
          className="cursor-pointer flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] mb-4 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          Automations
        </button>
        <h1 className="text-lg font-semibold">Edit Automation</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
          Update this rule&apos;s trigger, timing, or actions.
        </p>
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
