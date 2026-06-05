'use client'

import Link from 'next/link'
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
    <Link href={href} className="btn-pib-secondary justify-center text-xs">
      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{icon}</span>
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
    <section className="bento-card !p-6 space-y-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow">Setup command center</p>
          <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">CRM launch readiness</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
            Turn setup choices into an operating checklist: import data, connect the inbox, apply a pipeline, and build the first automation assets.
          </p>
        </div>
        <div className="min-w-[150px] rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
          <p className="eyebrow !text-[10px]">Readiness</p>
          <p className="mt-2 font-display text-4xl leading-none text-[var(--color-pib-text)]">{readiness}%</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
            <div
              className="h-full rounded-full bg-[var(--color-pib-accent)] transition-all duration-500"
              style={{ width: `${readiness}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <p className="eyebrow !text-[10px]">Workflow</p>
          <p className="mt-2 text-sm font-semibold capitalize text-[var(--color-pib-text)]">{pipelinePreference}</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Recommended setup lane</p>
        </div>
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <p className="eyebrow !text-[10px]">Selected assets</p>
          <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">{setup.selectedTemplateIds.length} starter template{setup.selectedTemplateIds.length === 1 ? '' : 's'}</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Chosen for rollout</p>
        </div>
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <p className="eyebrow !text-[10px]">Pipelines</p>
          <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">{setup.appliedPipelineTemplateIds.length} applied</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{pipelineTemplates} recommended</p>
        </div>
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <p className="eyebrow !text-[10px]">Template mix</p>
          <p className="mt-2 text-sm font-semibold text-[var(--color-pib-text)]">{sequenceTemplates} sequences / {segmentTemplates} segments</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{formTemplates} forms ready</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <p className="eyebrow !text-[10px]">Readiness blockers</p>
          {blockers.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">Setup is ready for daily CRM use.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {blockers.map((blocker) => (
                <span key={blocker} className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                  <span className="material-symbols-outlined text-[14px]">priority_high</span>
                  {blocker}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
          <p className="eyebrow !text-[10px]">Next actions</p>
          <div className="mt-3 grid gap-2">
            <CommandLink href={portalPath('/portal/capture-sources/import')} icon="upload_file">Open CSV import</CommandLink>
            <CommandLink href={portalPath('/portal/settings/pipelines')} icon="account_tree">Review pipelines</CommandLink>
            <CommandLink href={portalPath('/portal/settings/sequences')} icon="route">Build sequences</CommandLink>
          </div>
        </div>
      </div>
    </section>
  )
}
