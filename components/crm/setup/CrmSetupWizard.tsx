'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/studio'
import type {
  CrmGmailIntent,
  CrmImportStatus,
  CrmPipelinePreference,
  CrmSalesProcess,
  CrmSetupState,
  CrmStarterTemplate,
} from '@/lib/crm/setup/types'
import { CrmSetupCommandCenter } from '@/components/crm/setup/CrmSetupCommandCenter'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

const SALES_PROCESS_OPTIONS: Array<{ value: CrmSalesProcess; label: string }> = [
  { value: 'new_sales', label: 'New business sales' },
  { value: 'account_management', label: 'Account management' },
  { value: 'support_led', label: 'Support-led follow-up' },
  { value: 'mixed', label: 'Mixed workflow' },
]

const IMPORT_STATUS_OPTIONS: Array<{ value: CrmImportStatus; label: string }> = [
  { value: 'not_started', label: 'No import yet' },
  { value: 'planning', label: 'Preparing CSV' },
  { value: 'importing', label: 'Import in progress' },
  { value: 'done', label: 'Contacts imported' },
]

const GMAIL_OPTIONS: Array<{ value: CrmGmailIntent; label: string }> = [
  { value: 'connect_now', label: 'Connect Gmail now' },
  { value: 'connect_later', label: 'Connect later' },
  { value: 'not_now', label: 'Not needed' },
]

const PIPELINE_OPTIONS: Array<{ value: CrmPipelinePreference; label: string }> = [
  { value: 'simple_sales', label: 'Simple sales' },
  { value: 'consultative_sales', label: 'Consultative sales' },
  { value: 'service_delivery', label: 'Service delivery' },
  { value: 'renewals', label: 'Renewals' },
]

const TEAM_ROLLOUT_PLAN = [
  {
    title: 'Assign import owner',
    description: 'Name the person accountable for source data, CSV cleanup, and first import validation.',
    icon: 'assignment_ind',
  },
  {
    title: 'Choose first pipeline',
    description: 'Apply one pipeline before sales meetings so deal stages mean the same thing to everyone.',
    icon: 'account_tree',
  },
  {
    title: 'Prepare follow-up assets',
    description: 'Select the first sequence, segment, or form that turns imported contacts into daily action.',
    icon: 'route',
  },
]

function templateIcon(kind: CrmStarterTemplate['kind']) {
  if (kind === 'pipeline') return 'sync_alt'
  if (kind === 'sequence') return 'route'
  if (kind === 'segment') return 'groups'
  return 'dynamic_form'
}

function SetupLoadingState() {
  return (
    <div className="max-w-5xl space-y-2">
      <div className="flex h-11 items-center gap-2 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-3">
        <Icon name="rocket_launch" className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[15px] text-primary" />
        <div className="min-w-0">
          <p className="truncate text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">CRM setup</p>
          <h1 className="truncate text-sm font-medium leading-tight text-[var(--color-pib-text)]">Preparing CRM setup workspace</h1>
        </div>
      </div>
      <p className="px-1 text-xs text-[var(--color-pib-text-muted)]">
        Loading pipeline templates, import status, and launch blockers for this workspace.
      </p>

      <section className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45" aria-label="CRM setup loading preview">
        <div className="flex flex-col gap-3 border-b border-[var(--color-card-border)] p-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Setup command center</p>
            <h2 className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">CRM launch readiness</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
              We are preparing the workflow, starter assets, and first actions before the team starts editing setup.
            </p>
          </div>
          <div className="min-w-[150px] shrink-0 rounded-md border border-[var(--color-card-border)] bg-black/10 px-3 py-2">
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Readiness</p>
            <div className="pib-skeleton mt-2 h-6 w-16 rounded" />
            <div className="pib-skeleton mt-2 h-1.5 w-full rounded-md" />
          </div>
        </div>

        <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
          {['Workflow', 'Starter templates', 'Pipelines', 'Next actions'].map((label) => (
            <div key={label} className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">{label}</p>
              <div className="pib-skeleton mt-2 h-3.5 w-28 rounded" />
              <div className="pib-skeleton mt-2 h-2.5 w-20 rounded" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function CrmSetupWizard() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const setupApiPath = useMemo(() => scopedApiPath('/api/v1/crm/setup', orgScope), [orgScope])
  const applyTemplateApiPath = useMemo(() => scopedApiPath('/api/v1/crm/setup/apply-template', orgScope), [orgScope])
  const setupPortalPath = useMemo(
    () => (path: string) => scopedPortalPath(path, orgScope),
    [orgScope],
  )
  const [setup, setSetup] = useState<CrmSetupState | null>(null)
  const [templates, setTemplates] = useState<CrmStarterTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(setupApiPath)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Failed to load setup.')
        setSetup(body.data.setup)
        setTemplates(body.data.templates)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load setup.'))
      .finally(() => setLoading(false))
  }, [setupApiPath])

  const recommendedTemplates = useMemo(() => {
    if (!setup) return templates
    return templates.filter((template) => template.recommendedFor.includes(setup.pipelinePreference))
  }, [setup, templates])

  function update<K extends keyof CrmSetupState>(key: K, value: CrmSetupState[K]) {
    setSetup((current) => current ? { ...current, [key]: value } : current)
    setMessage(null)
  }

  function toggleTemplate(templateId: string) {
    if (!setup) return
    const selected = new Set(setup.selectedTemplateIds)
    if (selected.has(templateId)) selected.delete(templateId)
    else selected.add(templateId)
    update('selectedTemplateIds', Array.from(selected))
  }

  async function saveSetup() {
    if (!setup) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(setupApiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setup),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to save setup.')
      setSetup(body.data.setup)
      setMessage('Setup saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save setup.')
    } finally {
      setSaving(false)
    }
  }

  async function applyPipelineTemplate(templateId: string) {
    setApplyingId(templateId)
    setError(null)
    try {
      const res = await fetch(applyTemplateApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, makeDefault: false }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to apply template.')
      setMessage(body.data.applied ? 'Pipeline template applied.' : 'That pipeline already exists.')
      const setupRes = await fetch(setupApiPath)
      const setupBody = await setupRes.json()
      if (setupRes.ok) setSetup(setupBody.data.setup)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply template.')
    } finally {
      setApplyingId(null)
    }
  }

  if (loading) return <SetupLoadingState />
  if (!setup) {
    return (
      <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/45 px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
        {error ?? 'Setup could not be loaded.'}
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-2">
      <div className="flex h-11 items-center gap-2 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-3">
        <Icon name="rocket_launch" className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[15px] text-primary" />
        <div className="min-w-0">
          <p className="truncate text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Settings / CRM</p>
          <h1 className="truncate text-sm font-medium leading-tight text-[var(--color-pib-text)]">CRM setup</h1>
        </div>
        <p className="ml-auto hidden truncate text-xs text-[var(--color-pib-text-muted)] sm:block">
          Set the first version of your sales workflow, import plan, and starter templates.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-100">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
          {message}
        </div>
      )}

      <CrmSetupCommandCenter setup={setup} recommendedTemplates={recommendedTemplates} portalPath={setupPortalPath} />

      <section className="grid gap-2 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3 md:grid-cols-2">
        <Field label="Sales process">
          <select aria-label="Sales process" className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)]" value={setup.salesProcess} onChange={(e) => update('salesProcess', e.target.value as CrmSalesProcess)}>
            {SALES_PROCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Pipeline preference">
          <select aria-label="Pipeline preference" className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)]" value={setup.pipelinePreference} onChange={(e) => update('pipelinePreference', e.target.value as CrmPipelinePreference)}>
            {PIPELINE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="CSV import status">
          <select aria-label="CSV import status" className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)]" value={setup.importStatus} onChange={(e) => update('importStatus', e.target.value as CrmImportStatus)}>
            {IMPORT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Gmail connection">
          <select aria-label="Gmail connection" className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)]" value={setup.gmailIntent} onChange={(e) => update('gmailIntent', e.target.value as CrmGmailIntent)}>
            {GMAIL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
      </section>

      <section role="region" aria-label="Team rollout plan" className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
        <div className="flex flex-col gap-2 border-b border-[var(--color-card-border)] p-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">CEO rollout</p>
            <h2 className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">Team rollout plan</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
              Capture who owns setup, what the team should launch first, and which decisions need to be visible before CRM becomes daily operating rhythm.
            </p>
          </div>
          <div className={`pib-pill shrink-0 ${setup.notes?.trim() ? 'pib-pill-success' : 'pib-pill-warn'}`}>
            {setup.notes?.trim() ? 'Notes captured' : 'Notes needed'}
          </div>
        </div>

        <div className="grid gap-2 border-b border-[var(--color-card-border)] p-3 md:grid-cols-3">
          {TEAM_ROLLOUT_PLAN.map((step) => (
            <div key={step.title} className="flex items-start gap-2 rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <Icon name={step.icon} className="mt-0.5 text-[16px] text-primary" />
              <div className="min-w-0">
                <h3 className="text-xs font-medium text-[var(--color-pib-text)]">{step.title}</h3>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <label className="block space-y-1.5 p-3">
          <span className="block text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">CRM rollout notes</span>
          <textarea
            className="min-h-[96px] w-full resize-y rounded-md border border-[var(--color-card-border)] bg-transparent p-2 text-xs text-[var(--color-pib-text)]"
            value={setup.notes ?? ''}
            onChange={(e) => update('notes', e.target.value)}
            placeholder="Example: Mandy owns import, sales reviews pipeline Mondays, support handles renewals."
          />
        </label>
      </section>

      <section className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xs font-medium text-[var(--color-pib-text)]">Import contacts</h2>
            <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
              Use the existing CSV importer once your source file is ready. Validate first to preview mapping and skipped rows.
            </p>
          </div>
          <Link
            href={setupPortalPath('/portal/capture-sources/import')}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <Icon name="upload_file" className="text-[16px]" />
            Open CSV import
          </Link>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
        <div className="flex h-11 items-center justify-between border-b border-[var(--color-card-border)] px-3">
          <h2 className="text-xs font-medium text-[var(--color-pib-text)]">Starter templates</h2>
          <button
            type="button"
            onClick={saveSetup}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:opacity-50"
          >
            <Icon name="save" className="text-[16px]" />
            {saving ? 'Saving...' : 'Save setup'}
          </button>
        </div>

        <div className="grid gap-2 p-3 md:grid-cols-2">
          {recommendedTemplates.map((template) => {
            const selected = setup.selectedTemplateIds.includes(template.id)
            const applied = template.kind === 'pipeline' && setup.appliedPipelineTemplateIds.includes(template.id)
            return (
              <div key={template.id} className="rounded-md border border-[var(--color-card-border)] bg-black/10 p-2.5">
                <div className="flex items-start gap-2">
                  <Icon name={templateIcon(template.kind)} className="mt-0.5 text-[16px] text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-xs font-medium text-[var(--color-pib-text)]">{template.name}</h3>
                      <span className="pib-pill pib-pill-accent">{template.kind}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{template.description}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-pib-text-muted)]">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleTemplate(template.id)}
                      aria-label={`Select ${template.name} starter template`}
                    />
                    Select
                  </label>
                  {template.kind === 'pipeline' && (
                    <button
                      type="button"
                      onClick={() => applyPipelineTemplate(template.id)}
                      disabled={applied || applyingId === template.id}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] disabled:opacity-50"
                      aria-label={
                        applied
                          ? `${template.name} template applied`
                          : applyingId === template.id
                            ? `Applying ${template.name} template`
                            : `Apply ${template.name} template`
                      }
                    >
                      <Icon name={applied ? 'check' : 'add'} className="text-[16px]" />
                      {applied ? 'Applied' : applyingId === template.id ? 'Applying...' : 'Apply pipeline'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">{label}</span>
      {children}
    </label>
  )
}
