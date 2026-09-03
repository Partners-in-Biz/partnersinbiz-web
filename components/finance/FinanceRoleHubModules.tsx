'use client'

import Link from 'next/link'
import { Icon, Status, Title } from '@/components/studio'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import type { FinancePersona, FinanceRoleHubModule } from '@/lib/finance/role-ux/types'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

const PERSONA_LABEL: Record<FinancePersona, string> = {
  owner: 'Owner',
  bookkeeper: 'Bookkeeper',
  accountant: 'Accountant',
  practice: 'Practice',
}

const PERSONA_HINT: Record<FinancePersona, string> = {
  owner: 'Cash, runway, and approvals. Decisions without payout rails.',
  bookkeeper: 'Daily capture, bank import, and recon queue.',
  accountant: 'Period close, reports, and download-only packs.',
  practice: 'Multi-client switcher, notification centre, audit explorer.',
}

export function FinanceRoleHubModules({
  persona,
  modules,
  orgScope,
  onPersonaChange,
  availablePersonas = ['owner', 'bookkeeper', 'accountant', 'practice'],
}: {
  persona: FinancePersona
  modules: FinanceRoleHubModule[]
  orgScope: PortalOrgRouteScope
  onPersonaChange?: (persona: FinancePersona) => void
  availablePersonas?: FinancePersona[]
}) {
  return (
    <div className="st-panel space-y-4 p-4" data-testid="finance-role-hub-modules">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Title as="h2">Role hub</Title>
            <Status tone="info">{PERSONA_LABEL[persona]}</Status>
            <Status>Same design system</Status>
          </div>
          <p className="sc-body mt-1 text-xs text-[var(--sc-ink-soft)]">{PERSONA_HINT[persona]}</p>
        </div>
        {onPersonaChange ? (
          <div className="w-full max-w-[220px]">
            <ThemedSelect
              ariaLabel="Finance role persona"
              value={persona}
              options={availablePersonas.map((p) => ({ value: p, label: PERSONA_LABEL[p] }))}
              onValueChange={(value) => onPersonaChange(value as FinancePersona)}
              className="w-full"
              buttonClassName="w-full justify-between"
            />
          </div>
        ) : null}
      </div>

      {modules.length === 0 ? (
        <p className="sc-body text-sm text-[var(--sc-ink-soft)]" data-testid="finance-role-hub-empty">
          No modules visible for this role. Ask an admin for a finance assignment.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <Link
              key={module.id}
              href={scopedPortalPath(module.href.replace(/#.*$/, ''), orgScope) + (module.href.includes('#') ? module.href.slice(module.href.indexOf('#')) : '')}
              className="st-panel st-panel--flat p-3 transition-colors hover:border-[var(--sc-ink)]"
              data-testid={`finance-role-module-${module.id}`}
              data-persona={module.persona}
            >
              <div className="flex items-start gap-2">
                <Icon name={module.icon} className="shrink-0 text-[var(--sc-ink-soft)]" />
                <span className="min-w-0">
                  <p className="text-sm font-medium text-[var(--sc-ink)]">{module.title}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-[var(--sc-ink-soft)]">{module.summary}</p>
                  {module.emphasis === 'primary' ? (
                    <span className="mt-1.5 inline-block">
                      <Status tone="info">Primary</Status>
                    </span>
                  ) : null}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
