'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ClientDocument, ClientDocumentLinkSet } from '@/lib/client-documents/types'

type LinkKind = 'company' | 'contact' | 'org' | 'project' | 'deal'

type SearchResult = {
  id: string
  label: string
  summary?: string
}

type FieldConfig = {
  key: string
  title: string
  help: string
  kind: LinkKind
  mode: 'single' | 'multi'
}

const FIELD_CONFIGS: FieldConfig[] = [
  {
    key: 'primaryCompany',
    title: 'Primary company',
    help: 'Main CRM company this document is for.',
    kind: 'company',
    mode: 'single',
  },
  {
    key: 'additionalCompanies',
    title: 'Additional companies',
    help: 'Other CRM companies that should stay connected to this document.',
    kind: 'company',
    mode: 'multi',
  },
  {
    key: 'primaryContact',
    title: 'Primary contact',
    help: 'Main CRM contact for review, approval, or follow-up.',
    kind: 'contact',
    mode: 'single',
  },
  {
    key: 'additionalContacts',
    title: 'Additional contacts',
    help: 'Other CRM contacts associated with this document.',
    kind: 'contact',
    mode: 'multi',
  },
  {
    key: 'clientOrgs',
    title: 'Linked client orgs',
    help: 'Client portals that can be related to this document. Publishing to multiple orgs needs review.',
    kind: 'org',
    mode: 'multi',
  },
  {
    key: 'projects',
    title: 'Linked projects',
    help: 'Projects that should inherit or reference this document context.',
    kind: 'project',
    mode: 'multi',
  },
  {
    key: 'deals',
    title: 'Linked deals',
    help: 'CRM deals connected to this proposal, report, or agreement.',
    kind: 'deal',
    mode: 'multi',
  },
]

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]))
}

function without(value: string | undefined, values: string[] | undefined): string[] {
  return (values ?? []).filter((item) => item && item !== value)
}

function resultLabel(kind: LinkKind, row: Record<string, unknown>): string {
  const first = typeof row.firstName === 'string' ? row.firstName : ''
  const last = typeof row.lastName === 'string' ? row.lastName : ''
  const fullName = [first, last].filter(Boolean).join(' ')
  return (
    (typeof row.title === 'string' && row.title) ||
    (typeof row.name === 'string' && row.name) ||
    (typeof row.label === 'string' && row.label) ||
    (typeof row.companyName === 'string' && row.companyName) ||
    fullName ||
    `${kind} ${String(row.id ?? '')}`
  )
}

function normalizeSearchPayload(kind: LinkKind, body: unknown): SearchResult[] {
  const data = body && typeof body === 'object' && 'data' in body ? (body as { data?: unknown }).data : body
  const candidates =
    data && typeof data === 'object' && !Array.isArray(data) && 'refs' in data
      ? (data as { refs?: unknown }).refs
      : data && typeof data === 'object' && !Array.isArray(data) && 'items' in data
        ? (data as { items?: unknown }).items
        : data && typeof data === 'object' && !Array.isArray(data) && 'deals' in data
          ? (data as { deals?: unknown }).deals
          : data && typeof data === 'object' && !Array.isArray(data) && 'projects' in data
            ? (data as { projects?: unknown }).projects
            : data

  if (!Array.isArray(candidates)) return []
  return candidates
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return null
      const row = candidate as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id : typeof row.refId === 'string' ? row.refId : ''
      if (!id) return null
      return {
        id,
        label: resultLabel(kind, row),
        summary: typeof row.summary === 'string' ? row.summary : typeof row.description === 'string' ? row.description : undefined,
      }
    })
    .filter(Boolean) as SearchResult[]
}

function searchUrl(kind: LinkKind, orgId: string, q: string) {
  const params = new URLSearchParams()
  if (orgId) params.set('orgId', orgId)
  if (q.trim()) params.set(kind === 'deal' ? 'search' : 'q', q.trim())
  params.set('limit', '8')

  if (kind === 'company' || kind === 'contact' || kind === 'project') {
    params.set('type', kind)
    return `/api/v1/context-references/search?${params.toString()}`
  }

  if (kind === 'deal') return `/api/v1/crm/deals?${params.toString()}`

  return `/api/v1/organizations?${params.toString()}`
}

function buildInitialFields(linked: ClientDocumentLinkSet) {
  return {
    primaryCompany: unique([linked.companyId])[0] ?? '',
    additionalCompanies: without(linked.companyId, linked.companyIds),
    primaryContact: unique([linked.contactId])[0] ?? '',
    additionalContacts: without(linked.contactId, linked.contactIds),
    clientOrgs: unique([linked.clientOrgId, ...(linked.clientOrgIds ?? [])]),
    projects: unique([linked.projectId, ...(linked.projectIds ?? [])]),
    deals: unique([linked.dealId, ...(linked.dealIds ?? [])]),
  }
}

type FieldState = ReturnType<typeof buildInitialFields>

function applyManagedLinks(current: ClientDocumentLinkSet, fields: FieldState): ClientDocumentLinkSet {
  const next: ClientDocumentLinkSet = { ...current }
  const companyIds = unique([fields.primaryCompany, ...fields.additionalCompanies])
  const contactIds = unique([fields.primaryContact, ...fields.additionalContacts])
  const clientOrgIds = unique(fields.clientOrgs)
  const projectIds = unique(fields.projects)
  const dealIds = unique(fields.deals)

  if (fields.primaryCompany) next.companyId = fields.primaryCompany
  else delete next.companyId
  if (companyIds.length) next.companyIds = companyIds
  else delete next.companyIds

  if (fields.primaryContact) next.contactId = fields.primaryContact
  else delete next.contactId
  if (contactIds.length) next.contactIds = contactIds
  else delete next.contactIds

  if (clientOrgIds[0]) next.clientOrgId = clientOrgIds[0]
  else delete next.clientOrgId
  if (clientOrgIds.length) next.clientOrgIds = clientOrgIds
  else delete next.clientOrgIds

  if (projectIds[0]) next.projectId = projectIds[0]
  else delete next.projectId
  if (projectIds.length) next.projectIds = projectIds
  else delete next.projectIds

  if (dealIds[0]) next.dealId = dealIds[0]
  else delete next.dealId
  if (dealIds.length) next.dealIds = dealIds
  else delete next.dealIds

  return next
}

export function getClientVisibleOrgIds(document: Pick<ClientDocument, 'linked'>): string[] {
  return unique([document.linked?.clientOrgId, ...(document.linked?.clientOrgIds ?? [])])
}

export function DocumentRelationshipChips({ document }: { document: Pick<ClientDocument, 'linked'> }) {
  const linked = document.linked ?? {}
  const chips = [
    linked.companyId ? ['Primary company', linked.companyId] : null,
    ...(without(linked.companyId, linked.companyIds).map((id) => ['Company', id] as const)),
    linked.contactId ? ['Primary contact', linked.contactId] : null,
    ...(without(linked.contactId, linked.contactIds).map((id) => ['Contact', id] as const)),
    ...getClientVisibleOrgIds(document).map((id) => ['Client org', id] as const),
    ...unique([linked.projectId, ...(linked.projectIds ?? [])]).map((id) => ['Project', id] as const),
    ...unique([linked.dealId, ...(linked.dealIds ?? [])]).map((id) => ['Deal', id] as const),
  ].filter(Boolean) as Array<readonly [string, string]>

  if (chips.length === 0) return null

  return (
    <div className="flex max-w-3xl flex-wrap items-center gap-1" aria-label="Linked document relationships">
      {chips.map(([label, id]) => (
        <span
          key={`${label}:${id}`}
          className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]"
          title={id}
        >
          {label}: {id}
        </span>
      ))}
    </div>
  )
}

function RelationshipField({
  config,
  orgId,
  values,
  onChange,
  labels,
  onLabels,
}: {
  config: FieldConfig
  orgId: string
  values: string[]
  onChange: (values: string[]) => void
  labels: Record<string, string>
  onLabels: (labels: Record<string, string>) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runSearch() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(searchUrl(config.kind, orgId, query))
      const body = await res.json()
      if (!res.ok || body?.success === false) throw new Error(body?.error ?? `Search failed: ${res.status}`)
      setResults(normalizeSearchPayload(config.kind, body))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  function addResult(result: SearchResult) {
    onLabels({ ...labels, [result.id]: result.label })
    onChange(config.mode === 'single' ? [result.id] : unique([...values, result.id]))
    setQuery('')
    setResults([])
  }

  function remove(id: string) {
    onChange(values.filter((value) => value !== id))
  }

  return (
    <div className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--color-pib-text)]" htmlFor={`relationship-${config.key}`}>
          {config.title}
        </label>
        <p className="text-xs text-[var(--color-pib-text-muted)]">{config.help}</p>
      </div>

      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {values.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-pib-accent-soft)] px-2 py-1 text-xs text-[var(--color-pib-accent)]">
              {labels[id] ?? id}
              <button type="button" aria-label={`Remove ${config.title} ${id}`} onClick={() => remove(id)} className="text-[10px]">×</button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <input
          id={`relationship-${config.key}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void runSearch()
            }
          }}
          placeholder={`Search ${config.title.toLowerCase()} in this tenant…`}
          className="min-w-0 flex-1 rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
        />
        <button type="button" onClick={runSearch} disabled={loading} className="rounded border border-[var(--color-pib-line)] px-3 py-2 text-xs font-semibold disabled:opacity-50">
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {results.length > 0 && (
        <div className="mt-2 space-y-1" role="listbox" aria-label={`${config.title} results`}>
          {results.map((result) => (
            <button
              type="button"
              key={result.id}
              onClick={() => addResult(result)}
              className="block w-full rounded border border-[var(--color-pib-line)] px-3 py-2 text-left text-sm hover:bg-[var(--color-row-hover)]"
            >
              <span className="block font-medium">{result.label}</span>
              <span className="block text-xs text-[var(--color-pib-text-muted)]">{result.summary ?? result.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function DocumentRelationshipPanel({
  document,
  onChange,
}: {
  document: ClientDocument
  onChange: (next: ClientDocument) => void
}) {
  const [fields, setFields] = useState<FieldState>(() => buildInitialFields(document.linked ?? {}))
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setFields(buildInitialFields(document.linked ?? {}))
  }, [document.id, document.linked])

  const draftLinked = useMemo(() => applyManagedLinks(document.linked ?? {}, fields), [document.linked, fields])
  const clientOrgIds = unique([draftLinked.clientOrgId, ...(draftLinked.clientOrgIds ?? [])])

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/v1/client-documents/${document.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked: draftLinked }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.success === false) throw new Error(body?.error ?? `Save failed: ${res.status}`)
      onChange({ ...document, linked: draftLinked })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function updatePrimaryField(key: 'primaryCompany' | 'primaryContact', next: string[]) {
    setFields((current) => ({ ...current, [key]: next[0] ?? '' }))
  }

  function updateListField(key: 'additionalCompanies' | 'additionalContacts' | 'clientOrgs' | 'projects' | 'deals', next: string[]) {
    setFields((current) => ({ ...current, [key]: next }))
  }

  return (
    <section className="space-y-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-5">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-pib-text-muted)]">
          Document relationships
        </h3>
        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
          Search is scoped to the document tenant ({document.orgId}). Primary links are kept alongside the normalised multi-link fields.
        </p>
      </div>

      {clientOrgIds.length > 1 && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-200" role="alert">
          Client-visible warning: publishing this document would expose it to {clientOrgIds.length} linked client organisations.
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {FIELD_CONFIGS.map((config) => {
          const values =
            config.key === 'primaryCompany' ? (fields.primaryCompany ? [fields.primaryCompany] : [])
            : config.key === 'additionalCompanies' ? fields.additionalCompanies
            : config.key === 'primaryContact' ? (fields.primaryContact ? [fields.primaryContact] : [])
            : config.key === 'additionalContacts' ? fields.additionalContacts
            : config.key === 'clientOrgs' ? fields.clientOrgs
            : config.key === 'projects' ? fields.projects
            : fields.deals

          return (
            <RelationshipField
              key={config.key}
              config={config}
              orgId={document.orgId}
              values={values}
              labels={labels}
              onLabels={setLabels}
              onChange={(next) => {
                if (config.key === 'primaryCompany') updatePrimaryField('primaryCompany', next)
                else if (config.key === 'additionalCompanies') updateListField('additionalCompanies', next)
                else if (config.key === 'primaryContact') updatePrimaryField('primaryContact', next)
                else if (config.key === 'additionalContacts') updateListField('additionalContacts', next)
                else if (config.key === 'clientOrgs') updateListField('clientOrgs', next)
                else if (config.key === 'projects') updateListField('projects', next)
                else updateListField('deals', next)
              }}
            />
          )
        })}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="rounded bg-[var(--color-pib-accent)] px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">
          {saving ? 'Saving relationships…' : 'Save relationships'}
        </button>
        {saved && <span className="text-xs text-emerald-400">Relationships saved.</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </section>
  )
}
