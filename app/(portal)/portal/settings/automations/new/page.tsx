'use client'
export const dynamic = 'force-dynamic'

import { useRouter } from 'next/navigation'
import { AutomationRuleForm } from '@/components/crm/AutomationRuleForm'
import type { AutomationRule } from '@/lib/automations/types'

export default function NewAutomationPage() {
  const router = useRouter()

  function handleSave(_rule: AutomationRule) {
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
        <h1 className="text-lg font-semibold">New Automation</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
          Define a trigger and one or more actions to run automatically.
        </p>
      </div>

      <AutomationRuleForm onSave={handleSave} onCancel={handleCancel} />
    </div>
  )
}
