'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import type { CaptureSource } from '@/lib/crm/captureSources'
import {
  parseCsv,
  rowsFromCsv,
  type ParsedContactImportRow,
} from '@/lib/crm/csv-import'

interface OrganizationSummary {
  id: string
  slug: string
  name: string
}

interface InvalidRow {
  index: number
  reason: string
}

interface ImportResult {
  created: number
  updated: number
  skipped: number
  invalidRows: InvalidRow[]
  previewSample?: Array<Record<string, unknown>>
}

// ── Component ───────────────────────────────────────────────────────────────

export default function CaptureSourceImportPage() {
  const params = useParams()
  const slug = params.slug as string

  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [orgLookupDone, setOrgLookupDone] = useState(false)

  const [sources, setSources] = useState<CaptureSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string>('')
  const [defaultTagsRaw, setDefaultTagsRaw] = useState('')
  const [fileName, setFileName] = useState<string>('')
  const [rows, setRows] = useState<ParsedContactImportRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)

  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [validateResult, setValidateResult] = useState<ImportResult | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const defaultTags = useMemo(
    () =>
      defaultTagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    [defaultTagsRaw],
  )

  // Resolve slug → orgId
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/organizations')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        const list = (body.data ?? []) as OrganizationSummary[]
        const match = list.find((o) => o.slug === slug)
        setOrgId(match?.id ?? null)
        setOrgName(match?.name ?? '')
        setOrgLookupDone(true)
      })
      .catch(() => {
        if (!cancelled) setOrgLookupDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Load capture sources for the org
  useEffect(() => {
    if (!orgId) return
    fetch(`/api/v1/crm/capture-sources?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((body) => {
        setSources((body.data ?? []) as CaptureSource[])
      })
      .catch(() => {})
  }, [orgId])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSubmitError(null)
    setValidateResult(null)
    setImportResult(null)
    setRows([])
    setParseError(null)
    const file = e.target.files?.[0]
    if (!file) {
      setFileName('')
      return
    }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '')
        const grid = parseCsv(text)
        const parsed = rowsFromCsv(grid)
        if (parsed.length === 0) {
          setParseError('No data rows found. Make sure the first row contains headers and there is at least one row of data.')
          return
        }
        setRows(parsed)
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse CSV')
      }
    }
    reader.onerror = () => setParseError('Failed to read file')
    reader.readAsText(file)
  }

  async function callImport(dryRun: boolean): Promise<ImportResult | null> {
    if (!orgId) return null
    const payload = {
      capturedFromId: selectedSourceId || undefined,
      defaultTags: defaultTags.length ? defaultTags : undefined,
      rows,
      dryRun,
    }
    const res = await fetch(`/api/v1/crm/contacts/import?orgId=${encodeURIComponent(orgId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(body.error ?? 'Import failed')
    }
    return body.data as ImportResult
  }

  async function handleValidate() {
    setValidating(true)
    setSubmitError(null)
    setValidateResult(null)
    setImportResult(null)
    try {
      const result = await callImport(true)
      if (result) setValidateResult(result)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Validate failed')
    } finally {
      setValidating(false)
    }
  }

  async function handleImport() {
    setImporting(true)
    setSubmitError(null)
    setImportResult(null)
    try {
      const result = await callImport(false)
      if (result) setImportResult(result)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const previewRows = rows.slice(0, 10)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          {orgName || 'Workspace'}
        </p>
        <h1 className="text-2xl font-semibold text-on-surface">Import contacts from CSV</h1>
        <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
          Bulk-import contacts into this organisation. Existing contacts (matched by
          email) get their tags merged — names and other fields are not overwritten.
          CSV imports skip campaign auto-enrollment to avoid surprise sends.
        </p>
      </div>

      {orgLookupDone && !orgId && (
        <div className="rounded-xl bg-surface-container border border-outline-variant p-4 text-sm text-red-600">
          Could not find an organisation for slug &quot;{slug}&quot;.
        </div>
      )}

      {orgId && (
        <>
          <div className="rounded-xl bg-surface-container border border-outline-variant p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">
                CSV file
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="block text-sm text-on-surface file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-outline-variant file:bg-surface file:text-on-surface file:text-sm file:cursor-pointer"
              />
              {fileName && (
                <p className="mt-1 text-xs text-on-surface-variant">
                  {fileName} — parsed {rows.length} row{rows.length === 1 ? '' : 's'}
                </p>
              )}
              {parseError && (
                <p className="mt-1 text-sm text-red-600">{parseError}</p>
              )}
              <p className="mt-2 text-xs text-on-surface-variant">
                Expected headers (case-insensitive): email (required), name or
                firstname/lastname, company, phone, tags (comma- or semicolon-separated),
                notes.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">
                Default tags
              </label>
              <input
                type="text"
                value={defaultTagsRaw}
                onChange={(e) => setDefaultTagsRaw(e.target.value)}
                placeholder="e.g. q2-import, webinar-leads"
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
              />
              <p className="mt-1 text-xs text-on-surface-variant">
                Comma-separated. Applied to every imported contact in addition to
                per-row tags.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">
                Capture source (optional)
              </label>
              <select
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
              >
                <option value="">(none)</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.type}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-on-surface-variant">
                If set, imported contacts will be tagged with the source&apos;s
                autoTags and the source&apos;s captured-count will be bumped by the
                number of newly created contacts.
              </p>
            </div>
          </div>

          {previewRows.length > 0 && (
            <div className="rounded-xl bg-surface-container border border-outline-variant p-4">
              <h2 className="text-sm font-medium text-on-surface mb-2">
                Preview (first {previewRows.length} of {rows.length})
              </h2>
              <div className="overflow-x-auto rounded-lg border border-outline-variant">
                <table className="w-full text-sm">
                  <thead className="bg-surface-container">
                    <tr className="text-left text-xs uppercase tracking-wide text-on-surface-variant">
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Company</th>
                      <th className="px-3 py-2 font-medium">Phone</th>
                      <th className="px-3 py-2 font-medium">Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => {
                      const name =
                        r.name ??
                        [r.firstName, r.lastName].filter(Boolean).join(' ').trim()
                      return (
                        <tr key={i} className="border-t border-outline-variant align-top">
                          <td className="px-3 py-2 font-mono text-xs text-on-surface break-all">
                            {r.email}
                          </td>
                          <td className="px-3 py-2 text-on-surface">{name}</td>
                          <td className="px-3 py-2 text-on-surface">{r.company ?? ''}</td>
                          <td className="px-3 py-2 text-on-surface">{r.phone ?? ''}</td>
                          <td className="px-3 py-2 text-on-surface-variant">
                            {(r.tags ?? []).join(', ')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleValidate}
                disabled={validating || importing}
                className="px-4 py-2 rounded-lg bg-surface text-on-surface text-sm border border-outline-variant hover:bg-surface-container-high disabled:opacity-50 transition-colors"
              >
                {validating ? 'Validating…' : 'Validate (dry run)'}
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={validating || importing}
                className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
              >
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          )}

          {submitError && (
            <div className="rounded-xl bg-surface-container border border-outline-variant p-4 text-sm text-red-600">
              {submitError}
            </div>
          )}

          {validateResult && !importResult && (
            <ResultCard title="Validation result" result={validateResult} variant="dryrun" />
          )}

          {importResult && (
            <ResultCard title="Import complete" result={importResult} variant="done" />
          )}
        </>
      )}
    </div>
  )
}

function ResultCard({
  title,
  result,
  variant,
}: {
  title: string
  result: ImportResult
  variant: 'dryrun' | 'done'
}) {
  return (
    <div className="rounded-xl bg-surface-container border border-outline-variant p-4 space-y-3">
      <h2 className="text-sm font-medium text-on-surface">{title}</h2>
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label={variant === 'dryrun' ? 'Would create' : 'Created'}
          value={result.created}
        />
        <Stat
          label={variant === 'dryrun' ? 'Would update' : 'Updated'}
          value={result.updated}
        />
        <Stat label="Skipped" value={result.skipped} />
      </div>
      {result.invalidRows.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-on-surface-variant mb-1">
            Invalid rows
          </p>
          <ul className="space-y-1 text-sm text-on-surface">
            {result.invalidRows.slice(0, 50).map((r) => (
              <li key={r.index} className="font-mono text-xs">
                row {r.index}: {r.reason}
              </li>
            ))}
            {result.invalidRows.length > 50 && (
              <li className="text-xs text-on-surface-variant">
                …and {result.invalidRows.length - 50} more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface p-3">
      <p className="text-[10px] uppercase tracking-widest text-on-surface-variant">
        {label}
      </p>
      <p className="text-2xl font-semibold text-on-surface">{value}</p>
    </div>
  )
}
