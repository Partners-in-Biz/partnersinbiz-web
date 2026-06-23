'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CaptureSource } from '@/lib/crm/captureSources'
import {
  parseCsv,
  autoMapHeaders,
  rowsFromGridWithMapping,
  CONTACT_IMPORT_FIELDS,
  type ParsedContactImportRow,
} from '@/lib/crm/csv-import'

const IGNORE_COLUMN = '__ignore__'


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

interface CaptureSourceImportWorkspaceProps {
  orgId: string
  orgName: string
}

function scopedHeaders(orgId: string, contentType = false) {
  return {
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    'X-Org-Id': orgId,
  }
}

export function CaptureSourceImportWorkspace({ orgId, orgName }: CaptureSourceImportWorkspaceProps) {

  const [sources, setSources] = useState<CaptureSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string>('')
  const [defaultTagsRaw, setDefaultTagsRaw] = useState('')
  const [fileName, setFileName] = useState<string>('')
  // Raw parsed CSV grid (incl. header row) — the column mapping is applied on top.
  const [grid, setGrid] = useState<string[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  // colMap[i] = target contact field for CSV column i, or null to ignore it.
  const [colMap, setColMap] = useState<Array<keyof ParsedContactImportRow | null>>([])
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

  // Apply the (possibly user-overridden) column mapping to produce import rows.
  const rows = useMemo<ParsedContactImportRow[]>(
    () => (grid.length > 0 ? rowsFromGridWithMapping(grid, colMap) : []),
    [grid, colMap],
  )

  // Email is required by the import API — block submit until a column maps to it.
  const emailMapped = colMap.includes('email')


  // Load capture sources for the org
  useEffect(() => {
    if (!orgId) return
    fetch(`/api/v1/crm/capture-sources?orgId=${encodeURIComponent(orgId)}`, { headers: scopedHeaders(orgId) })
      .then((r) => r.json())
      .then((body) => {
        setSources((body.data ?? []) as CaptureSource[])
      })
      .catch(() => {})
  }, [orgId])

  function resetParsed() {
    setGrid([])
    setHeaders([])
    setColMap([])
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSubmitError(null)
    setValidateResult(null)
    setImportResult(null)
    resetParsed()
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
        const parsedGrid = parseCsv(text)
        if (parsedGrid.length < 2) {
          setParseError('No data rows found. Make sure the first row contains headers and there is at least one row of data.')
          return
        }
        const header = parsedGrid[0]
        setGrid(parsedGrid)
        setHeaders(header)
        // Seed the mapping from header aliases; the user adjusts each column below.
        setColMap(autoMapHeaders(header))
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Failed to parse CSV')
      }
    }
    reader.onerror = () => setParseError('Failed to read file')
    reader.readAsText(file)
  }

  function setColumnMapping(columnIndex: number, value: string) {
    setValidateResult(null)
    setImportResult(null)
    setColMap((prev) => {
      const next = [...prev]
      next[columnIndex] = value === IGNORE_COLUMN ? null : (value as keyof ParsedContactImportRow)
      return next
    })
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
      headers: scopedHeaders(orgId, true),
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

  // Preview the first 5 mapped rows so the user can confirm the mapping before committing.
  const previewRows = rows.slice(0, 5)

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


      <>          <div className="rounded-xl bg-surface-container border border-outline-variant p-4 space-y-4">
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

          {headers.length > 0 && (
            <div className="rounded-xl bg-surface-container border border-outline-variant p-4 space-y-3">
              <div>
                <h2 className="text-sm font-medium text-on-surface">Map columns</h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Match each column in your file to a contact field. Columns set to
                  &ldquo;Ignore&rdquo; are not imported. A column must be mapped to
                  <span className="font-medium"> Email</span> before you can import.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {headers.map((header, columnIndex) => {
                  const sampleValue = (grid[1] ?? [])[columnIndex]?.trim() ?? ''
                  const current = colMap[columnIndex] ?? IGNORE_COLUMN
                  return (
                    <div
                      key={`${header}-${columnIndex}`}
                      className="rounded-lg border border-outline-variant bg-surface p-3"
                    >
                      <p className="text-[11px] font-medium text-on-surface break-all">
                        {header || `Column ${columnIndex + 1}`}
                      </p>
                      {sampleValue && (
                        <p className="mt-0.5 text-[11px] text-on-surface-variant break-all">
                          e.g. {sampleValue}
                        </p>
                      )}
                      <label className="sr-only" htmlFor={`col-map-${columnIndex}`}>
                        Map column {header || columnIndex + 1} to a contact field
                      </label>
                      <select
                        id={`col-map-${columnIndex}`}
                        value={current}
                        onChange={(e) => setColumnMapping(columnIndex, e.target.value)}
                        className="mt-2 w-full px-2 py-1.5 rounded-md border border-outline-variant bg-surface text-on-surface text-xs"
                      >
                        <option value={IGNORE_COLUMN}>Ignore this column</option>
                        {CONTACT_IMPORT_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
              {!emailMapped && (
                <p className="text-xs text-amber-600">
                  Map one column to Email to enable validation and import.
                </p>
              )}
            </div>
          )}

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
                disabled={validating || importing || !emailMapped}
                className="px-4 py-2 rounded-lg bg-surface text-on-surface text-sm border border-outline-variant hover:bg-surface-container-high disabled:opacity-50 transition-colors"
              >
                {validating ? 'Validating…' : 'Validate (dry run)'}
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={validating || importing || !emailMapped}
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
