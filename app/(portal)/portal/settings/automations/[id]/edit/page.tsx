'use client'
export const dynamic = 'force-dynamic'

import { Button, Icon, Notice, Panel, Skeleton, Title } from '@/components/studio'
import { PageHeader } from '@/components/ui/AppFoundation'

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
          <Button type="button" variant="ghost" size="sm" onClick={handleCancel} className="mb-4">
            <Icon name="arrow_back" />
            Automations
          </Button>
          <PageHeader
            title="Edit automation."
            description="Tune the trigger, timing, and execution chain without breaking the rule's operational intent."
          />
        </div>
        {rule && (
          <Panel flat className="w-full max-w-sm">
            <p className="sc-tiny">{rule.enabled ? 'Currently live' : 'Currently paused'}</p>
            <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
              {rule.actions.length} action{rule.actions.length === 1 ? '' : 's'} configured for this automation.
            </p>
          </Panel>
        )}
      </header>

      {loading ? (
        <Panel className="space-y-3">
          <Skeleton height={16} className="w-1/3" />
          <Skeleton height={16} className="w-2/3" />
          <Skeleton height={16} className="w-1/2" />
        </Panel>
      ) : fetchError ? (
        <Panel as="section" className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-4">
              <Icon name="warning" />
              <div>
                <p className="sc-tiny">Source health</p>
                <Title className="mt-1">Automation rule could not load</Title>
                <Notice tone="danger">{fetchError}</Notice>
                <p className="sc-body mt-3 text-[0.75rem] text-[var(--sc-ink-soft)]">
                  Trigger, timing, and action controls stay hidden until the automation source responds, so teams do not change workflow rules from stale or partial data.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => loadRule()} aria-label="Retry loading automation rule">
                <Icon name="refresh" />
                Retry
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                Back to automations
              </Button>
            </div>
          </div>
        </Panel>
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
