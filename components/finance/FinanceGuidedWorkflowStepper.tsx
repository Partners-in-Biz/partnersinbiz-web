'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Status, Steps, Title } from '@/components/studio'
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
  const safeStep = Math.min(activeStep, Math.max(view.steps.length - 1, 0))
  const step = view.steps[safeStep]

  return (
    <div className="st-panel space-y-4 p-4" data-testid="finance-guided-workflow-stepper">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Title as="h2">Guided workflows</Title>
            <Status>Day-one density</Status>
          </div>
          <p className="sc-body mt-1 text-xs text-[var(--sc-ink-soft)]">
            First month close, first pay run, and first bank recon. Role-gated steps on the live design system.
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

      <p className="sc-body text-xs text-[var(--sc-ink-soft)]">{view.workflow.description}</p>
      <Steps steps={view.steps.map((s) => s.title)} current={safeStep} />

      <ol className="flex flex-wrap gap-2" data-testid="finance-workflow-step-list">
        {view.steps.map((s, index) => (
          <li key={s.id}>
            <button
              type="button"
              className={`border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                index === safeStep
                  ? 'border-[var(--sc-accent)] text-[var(--sc-ink)]'
                  : 'border-[var(--sc-line)] text-[var(--sc-ink-soft)] hover:bg-[color-mix(in_srgb,var(--sc-ink)_4%,transparent)]'
              }`}
              onClick={() => setActiveStep(index)}
              data-testid={`finance-workflow-step-tab-${s.id}`}
              data-status={s.status}
            >
              {index + 1}. {s.title}
              {!s.canComplete ? ' · locked' : s.approvalGated ? ' · SOD' : ''}
            </button>
          </li>
        ))}
      </ol>

      {step ? (
        <div className="st-panel st-panel--flat p-3" data-testid={`finance-workflow-step-panel-${step.id}`} data-can-complete={step.canComplete ? 'true' : 'false'}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="st-title text-sm">
              Step {safeStep + 1}: {step.title}
            </p>
            {step.canComplete ? <Status tone="info">Your role</Status> : <Status>Role blocked</Status>}
            {step.approvalGated ? <Status tone="warning">Approval gated</Status> : null}
          </div>
          <p className="sc-body mt-1 text-xs leading-5 text-[var(--sc-ink-soft)]">{step.detail}</p>
          {step.hardGateNote ? <p className="mt-1 text-[11px] text-[var(--sc-ink-soft)]">Hard gate: {step.hardGateNote}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {step.canComplete ? (
              <Link href={scopedPortalPath(step.href, orgScope)} className="st-btn st-btn--primary st-btn--sm" data-testid="finance-workflow-step-cta">
                Open step
              </Link>
            ) : (
              <span className="text-xs text-[var(--sc-ink-soft)]" data-testid="finance-workflow-step-blocked">
                Visible for orientation only. Your assignment cannot complete this step.
              </span>
            )}
            <button type="button" className="st-btn st-btn--secondary st-btn--sm" disabled={safeStep <= 0} onClick={() => setActiveStep((n) => Math.max(0, n - 1))}>
              Back
            </button>
            <button type="button" className="st-btn st-btn--secondary st-btn--sm" disabled={safeStep >= view.steps.length - 1} onClick={() => setActiveStep((n) => Math.min(view.steps.length - 1, n + 1))}>
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
