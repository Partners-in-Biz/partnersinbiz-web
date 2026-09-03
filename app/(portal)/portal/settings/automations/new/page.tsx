'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AutomationRuleForm } from '@/components/crm/AutomationRuleForm'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Button, Icon, Panel } from '@/components/studio'
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
    <div className="max-w-6xl space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={handleCancel} className="mb-4">
            <Icon name="arrow_back" />
            Automations
          </Button>
          <PageHeader
            title="New automation."
            description="Define the CRM moment, timing, and execution chain so the team gets consistent follow-up without manual chasing."
          />
        </div>
        <Panel flat className="w-full max-w-sm">
          <p className="sc-tiny">Recommended starting point</p>
          <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
            Start with one trigger and one high-confidence action, then expand once the rule is live.
          </p>
        </Panel>
      </header>

      <AutomationRuleForm
        endpoint={automationEndpoint('/api/v1/crm/automations')}
        sequencesEndpoint={automationEndpoint('/api/v1/crm/sequences')}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  )
}
