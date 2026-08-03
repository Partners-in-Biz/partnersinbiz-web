'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { HudChip } from '@/components/ui/HudChip'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import {
  buildGuidedWorkflowView,
  listGuidedWorkflowsForPersona,
} from '@/lib/finance/role-ux/catalog'
import type { FinanceGuidedWorkflowId, FinancePersona, FinanceRoleUxContext } from '@/lib/finance/role-ux/types'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

export function FinanceGuidedWorkflowStepper({
  persona,
  ctx,
  orgScope,
  initialWorkflowId,
}: {
  persona: FinancePersona
  ctx: FinanceRoleUxContext
  orgScope: PortalOrgRouteScope
  initialWorkflowId?: FinanceGuidedWorkflowId
}) {
  const workflows = useMemo(() => listGuidedWorkflowsForPersona(persona), [persona])
  const defaultId = initialWorkflowId && workflows.some((w) => w.id === initialWorkflowId)
    ? initialWorkflowId
    : workflows[0]?.id ?? 'first_month_close'
  const [workflowId, setWorkflowId] = useState<FinanceGuidedWorkflowId>(defaultId)
  const [activeStep, setActiveStep] = useState(0)

  const view = useMemo(() => buildGuidedWorkflowView(workflowId, ctx), [workflowId, ctx])

  // Reset step index when workflow changes
  const safeStep = Math.min(activeStep, Math.max(view.steps.length - 1, 0))
  const step = view.steps[safeStep]

  return (
    <Card className="space-y-3 p-4" data-testid="finance-guided-workflow-stepper">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-pib-text)]">Guided workflows</h2>
            <HudChip>Day-one density</HudChip>
          </div>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            First month close, first pay run, and first bank recon — role-gated steps on the live design system.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <ThemedSelect
            ariaLabel="Guided workflow"
            value={workflowId}
            options={workflows.map((w) => ({ value: w.id, label: w.title }))}
            onValueChange={(value) => {
              setWorkflowId(value as FinanceGuidedWorkflowId)
              setActiveStep(0)
            }}
            className="w-full"
            buttonClassName="w-full justify-between"
          />
        </div>
      </div>

      <p className="text-xs text-[var(--color-pib-text-muted)]">{view.workflow.description}</p>

      <ol className="flex flex-wrap gap-2" data-testid="finance-workflow-step-list">
        {view.steps.map((s, index) => {
          const tone =
            index === safeStep ? 'accent' : s.canComplete ? undefined : undefined
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  index === safeStep
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-text)]'
                    : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                }`}
                onClick={() => setActiveStep(index)}
                data-testid={`finance-workflow-step-tab-${s.id}`}
                data-status={s.status}
              >
                {index + 1}. {s.title}
                {!s.canComplete ? ' · locked' : s.approvalGated ? ' · SOD' : ''}
              </button>
              {tone ? null : null}
            </li>
          )
        })}
      </ol>

      {step ? (
        <div
          className="rounded-lg border border-[var(--color-pib-line)] p-3"
          data-testid={`finance-workflow-step-panel-${step.id}`}
          data-can-complete={step.canComplete ? 'true' : 'false'}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">
              Step {safeStep + 1}: {step.title}
            </p>
            {step.canComplete ? <HudChip tone="accent">Your role</HudChip> : <HudChip>Role blocked</HudChip>}
            {step.approvalGated ? <HudChip>Approval gated</HudChip> : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{step.detail}</p>
          {step.hardGateNote ? (
            <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">Hard gate: {step.hardGateNote}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {step.canComplete ? (
              <Link
                href={scopedPortalPath(step.href, orgScope)}
                className="pib-btn-primary btn-pib-sm"
                data-testid="finance-workflow-step-cta"
              >
                Open step
              </Link>
            ) : (
              <span className="text-xs text-[var(--color-pib-text-muted)]" data-testid="finance-workflow-step-blocked">
                Visible for orientation only — your assignment cannot complete this step.
              </span>
            )}
            <button
              type="button"
              className="pib-btn-secondary btn-pib-sm"
              disabled={safeStep <= 0}
              onClick={() => setActiveStep((n) => Math.max(0, n - 1))}
            >
              Back
            </button>
            <button
              type="button"
              className="pib-btn-secondary btn-pib-sm"
              disabled={safeStep >= view.steps.length - 1}
              onClick={() => setActiveStep((n) => Math.min(view.steps.length - 1, n + 1))}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
