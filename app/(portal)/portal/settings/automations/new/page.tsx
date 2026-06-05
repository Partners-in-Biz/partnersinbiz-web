'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AutomationRuleForm } from '@/components/crm/AutomationRuleForm'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function NewAutomationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const automationEndpoint = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])
  const automationHref = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])

  function handleSave() {
    router.push(automationHref('/portal/settings/automations'))
  }

  function handleCancel() {
    router.push(automationHref('/portal/settings/automations'))
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
          <h1 className="pib-page-title mt-2">New automation</h1>
          <p className="pib-page-sub max-w-2xl">
            Define the CRM moment, timing, and execution chain so the team gets consistent follow-up without manual chasing.
          </p>
        </div>
        <div className="bento-card !p-4 w-full max-w-sm">
          <p className="text-xs font-medium">Recommended starting point</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Start with one trigger and one high-confidence action, then expand once the rule is live.
          </p>
        </div>
      </div>

      <AutomationRuleForm
        endpoint={automationEndpoint('/api/v1/crm/automations')}
        sequencesEndpoint={automationEndpoint('/api/v1/crm/sequences')}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  )
}
