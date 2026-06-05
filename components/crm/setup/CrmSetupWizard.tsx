'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="eyebrow">CRM setup</p>
        <h1 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Preparing CRM setup workspace</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          Loading pipeline templates, import status, and launch blockers for this workspace.
        </p>
      </div>

      <section className="bento-card !p-6 space-y-5" aria-label="CRM setup loading preview">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="eyebrow">Setup command center</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">CRM launch readiness</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
              We are preparing the workflow, starter assets, and first actions before the team starts editing setup.
            </p>
          </div>
          <div className="min-w-[150px] rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <p className="eyebrow !text-[10px]">Readiness</p>
            <div className="pib-skeleton mt-3 h-9 w-20 rounded" />
            <div className="pib-skeleton mt-4 h-2 w-full rounded-full" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {['Workflow', 'Starter templates', 'Pipelines', 'Next actions'].map((label) => (
            <div key={label} className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
              <p className="eyebrow !text-[10px]">{label}</p>
              <div className="pib-skeleton mt-3 h-4 w-28 rounded" />
              <div className="pib-skeleton mt-3 h-3 w-20 rounded" />
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
      <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">
        {error ?? 'Setup could not be loaded.'}
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold mb-1">CRM setup</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Set the first version of your sales workflow, import plan, and starter templates.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-accent-soft)] px-4 py-3 text-sm text-[var(--color-pib-text)]">
          {message}
        </div>
      )}

      <CrmSetupCommandCenter setup={setup} recommendedTemplates={recommendedTemplates} portalPath={setupPortalPath} />

      <section className="grid gap-4 md:grid-cols-2">
        <Field label="Sales process">
          <select className="pib-input w-full" value={setup.salesProcess} onChange={(e) => update('salesProcess', e.target.value as CrmSalesProcess)}>
            {SALES_PROCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Pipeline preference">
          <select className="pib-input w-full" value={setup.pipelinePreference} onChange={(e) => update('pipelinePreference', e.target.value as CrmPipelinePreference)}>
            {PIPELINE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="CSV import status">
          <select className="pib-input w-full" value={setup.importStatus} onChange={(e) => update('importStatus', e.target.value as CrmImportStatus)}>
            {IMPORT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Gmail connection">
          <select className="pib-input w-full" value={setup.gmailIntent} onChange={(e) => update('gmailIntent', e.target.value as CrmGmailIntent)}>
            {GMAIL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
      </section>

      <section role="region" aria-label="Team rollout plan" className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="eyebrow !text-[10px]">CEO rollout</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Team rollout plan</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
              Capture who owns setup, what the team should launch first, and which decisions need to be visible before CRM becomes daily operating rhythm.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">
            {setup.notes?.trim() ? 'Notes captured' : 'Notes needed'}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {TEAM_ROLLOUT_PLAN.map((step) => (
            <div key={step.title} className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
              <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">{step.icon}</span>
              <h3 className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">{step.title}</h3>
              <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{step.description}</p>
            </div>
          ))}
        </div>

        <label className="mt-5 block space-y-2">
          <span className="block text-xs font-label text-[var(--color-pib-text-muted)]">CRM rollout notes</span>
          <textarea
            className="pib-input min-h-[120px] w-full resize-y"
            value={setup.notes ?? ''}
            onChange={(e) => update('notes', e.target.value)}
            placeholder="Example: Mandy owns import, sales reviews pipeline Mondays, support handles renewals."
          />
        </label>
      </section>

      <section className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Import contacts</h2>
            <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
              Use the existing CSV importer once your source file is ready. Validate first to preview mapping and skipped rows.
            </p>
          </div>
          <Link href={setupPortalPath('/portal/capture-sources/import')} className="btn-pib-secondary inline-flex items-center gap-1.5 text-sm">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">upload_file</span>
            Open CSV import
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Starter templates</h2>
          <button type="button" onClick={saveSetup} disabled={saving} className="btn-pib-accent inline-flex items-center gap-1.5 text-sm disabled:opacity-50">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">save</span>
            {saving ? 'Saving...' : 'Save setup'}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {recommendedTemplates.map((template) => {
            const selected = setup.selectedTemplateIds.includes(template.id)
            const applied = template.kind === 'pipeline' && setup.appliedPipelineTemplateIds.includes(template.id)
            return (
              <div key={template.id} className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">{templateIcon(template.kind)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{template.name}</h3>
                      <span className="rounded border border-[var(--color-pib-line)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-pib-text-muted)]">{template.kind}</span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{template.description}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--color-pib-text-muted)]">
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
                      className="btn-pib-secondary inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
                      aria-label={
                        applied
                          ? `${template.name} template applied`
                          : applyingId === template.id
                            ? `Applying ${template.name} template`
                            : `Apply ${template.name} template`
                      }
                    >
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{applied ? 'check' : 'add'}</span>
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
      <span className="block text-xs font-label text-[var(--color-pib-text-muted)]">{label}</span>
      {children}
    </label>
  )
}
