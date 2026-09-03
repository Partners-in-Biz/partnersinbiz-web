'use client'

import Link from 'next/link'
import { Icon } from '@/components/studio'
import type {
  CrmSetupState,
  CrmStarterTemplate,
} from '@/lib/crm/setup/types'

export type SetupCommandState = Pick<
  CrmSetupState,
  | 'id'
  | 'orgId'
  | 'salesProcess'
  | 'importStatus'
  | 'gmailIntent'
  | 'pipelinePreference'
  | 'selectedTemplateIds'
  | 'appliedPipelineTemplateIds'
  | 'createdAt'
  | 'updatedAt'
>

export type SetupCommandTemplate = Pick<
  CrmStarterTemplate,
  'id' | 'kind' | 'name' | 'description' | 'recommendedFor'
>

interface Props {
  setup: SetupCommandState
  recommendedTemplates: SetupCommandTemplate[]
  portalPath?: (path: string) => string
}

export function setupReadinessScore(setup: SetupCommandState): number {
  const importReady = setup.importStatus === 'done' ? 25 : setup.importStatus === 'importing' ? 15 : setup.importStatus === 'planning' ? 10 : 0
  const gmailReady = setup.gmailIntent === 'connect_now' ? 25 : setup.gmailIntent === 'connect_later' ? 10 : 0
  const templateReady = setup.selectedTemplateIds.length >= 2 ? 25 : setup.selectedTemplateIds.length === 1 ? 15 : 0
  const pipelineReady = setup.appliedPipelineTemplateIds.length > 0 ? 25 : 0
  return Math.min(100, Math.round(importReady + gmailReady + templateReady + pipelineReady))
}

function setupBlockers(setup: SetupCommandState): string[] {
  return [
    setup.importStatus === 'done' ? '' : setup.importStatus === 'not_started' ? 'Import not started' : 'Import plan in progress',
    setup.gmailIntent === 'connect_now' ? '' : 'Gmail not ready',
    setup.selectedTemplateIds.length > 0 ? '' : 'No starter templates selected',
    setup.appliedPipelineTemplateIds.length > 0 ? '' : 'Pipeline not applied',
  ].filter(Boolean)
}

function templateKindCount(templates: SetupCommandTemplate[], kind: SetupCommandTemplate['kind']): number {
  return templates.filter((template) => template.kind === kind).length
}

function CommandLink({ href, icon, children }: { href: string; icon: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
    >
      <Icon name={icon} className="text-[14px]" />
      {children}
    </Link>
  )
}

export function CrmSetupCommandCenter({ setup, recommendedTemplates, portalPath = (path) => path }: Props) {
  const readiness = setupReadinessScore(setup)
  const blockers = setupBlockers(setup)
  const pipelineTemplates = templateKindCount(recommendedTemplates, 'pipeline')
  const sequenceTemplates = templateKindCount(recommendedTemplates, 'sequence')
  const segmentTemplates = templateKindCount(recommendedTemplates, 'segment')
  const formTemplates = templateKindCount(recommendedTemplates, 'form')
  const pipelinePreference = setup.pipelinePreference.replace(/_/g, ' ')

  return (
    <section className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
      <div className="flex flex-col gap-3 border-b border-[var(--color-card-border)] p-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Setup command center</p>
          <h2 className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">CRM launch readiness</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
            Turn setup choices into an operating checklist: import data, connect the inbox, apply a pipeline, and build the first automation assets.
          </p>
        </div>
        <div className="min-w-[150px] shrink-0 rounded-md border border-[var(--color-card-border)] bg-black/10 px-3 py-2">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Readiness</p>
          <p className="mt-1 text-2xl font-medium leading-none text-[var(--color-pib-text)]">{readiness}%</p>
          <div className="mt-2 h-1.5 overflow-hidden bg-white/[0.08] rounded-md">
            <div
              className="h-full rounded-md bg-[var(--color-accent-v2)] transition-all duration-500"
              style={{ width: `${readiness}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-2 border-b border-[var(--color-card-border)] p-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Workflow</p>
          <p className="mt-1 text-sm font-medium capitalize text-[var(--color-pib-text)]">{pipelinePreference}</p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Recommended setup lane</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Selected assets</p>
          <p className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">{setup.selectedTemplateIds.length} starter template{setup.selectedTemplateIds.length === 1 ? '' : 's'}</p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Chosen for rollout</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Pipelines</p>
          <p className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">{setup.appliedPipelineTemplateIds.length} applied</p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{pipelineTemplates} recommended</p>
        </div>
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Template mix</p>
          <p className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">{sequenceTemplates} sequences / {segmentTemplates} segments</p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{formTemplates} forms ready</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 p-3 lg:border-r lg:border-[var(--color-card-border)]">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Readiness blockers</p>
          {blockers.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Setup is ready for daily CRM use.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {blockers.map((blocker) => (
                <span key={blocker} className="pib-pill pib-pill-warn h-7">
                  <Icon name="priority_high" className="text-[13px]" />
                  {blocker}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 border-t border-[var(--color-card-border)] p-3 lg:border-t-0">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Next actions</p>
          <div className="mt-2 grid gap-1.5">
            <CommandLink href={portalPath('/portal/capture-sources/import')} icon="upload_file">Open CSV import</CommandLink>
            <CommandLink href={portalPath('/portal/settings/pipelines')} icon="account_tree">Review pipelines</CommandLink>
            <CommandLink href={portalPath('/portal/settings/sequences')} icon="route">Build sequences</CommandLink>
          </div>
        </div>
      </div>
    </section>
  )
}
