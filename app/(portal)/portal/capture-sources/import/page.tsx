'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { CaptureSource } from '@/lib/crm/captureSources'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

interface ParsedRow {
  email: string
  name?: string
  firstName?: string
  lastName?: string
  company?: string
  phone?: string
  tags?: string[]
  notes?: string
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

// ── CSV parsing ─────────────────────────────────────────────────────────────
//
// Minimal RFC-4180-ish parser. Handles:
//   - Quoted fields with commas inside
//   - Escaped quotes ("") inside quoted fields
//   - CRLF, LF, or CR line endings
//   - UTF-8 BOM stripping

function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < src.length) {
    const ch = src[i]

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      if (ch === '\r' && src[i + 1] === '\n') i += 2
      else i++
      continue
    }
    field += ch
    i++
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }

  return rows
}

const HEADER_ALIASES: Record<string, keyof ParsedRow> = {
  email: 'email',
  'e-mail': 'email',
  name: 'name',
  fullname: 'name',
  'full name': 'name',
  firstname: 'firstName',
  'first name': 'firstName',
  first_name: 'firstName',
  lastname: 'lastName',
  'last name': 'lastName',
  last_name: 'lastName',
  surname: 'lastName',
  company: 'company',
  organization: 'company',
  organisation: 'company',
  phone: 'phone',
  tel: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  tags: 'tags',
  notes: 'notes',
  note: 'notes',
}

function normalizeHeader(h: string): keyof ParsedRow | null {
  const key = h.trim().toLowerCase()
  return HEADER_ALIASES[key] ?? null
}

function rowsFromCsv(grid: string[][]): ParsedRow[] {
  if (grid.length === 0) return []
  const header = grid[0]
  const colMap: Array<keyof ParsedRow | null> = header.map(normalizeHeader)

  const out: ParsedRow[] = []
  for (let r = 1; r < grid.length; r++) {
    const cols = grid[r]
    if (cols.every((c) => c.trim() === '')) continue
    const row: ParsedRow = { email: '' }
    for (let c = 0; c < cols.length; c++) {
      const key = colMap[c]
      if (!key) continue
      const value = cols[c]
      if (key === 'tags') {
        const tags = value
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean)
        if (tags.length) row.tags = tags
      } else {
        const v = value.trim()
        if (v) (row as unknown as Record<string, unknown>)[key] = v
      }
    }
    out.push(row)
  }
  return out
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PortalCaptureSourceImportPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const captureSourcesEndpoint = scopedApiPath('/api/v1/crm/capture-sources', orgScope)
  const contactsImportEndpoint = scopedApiPath('/api/v1/crm/contacts/import', orgScope)
  const captureSourcesHref = scopedPortalPath('/portal/capture-sources', orgScope)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string>('')
  const [defaultTagsRaw, setDefaultTagsRaw] = useState('')
  const [fileName, setFileName] = useState<string>('')
  const [rows, setRows] = useState<ParsedRow[]>([])
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

  // Load capture sources
  useEffect(() => {
    fetch(captureSourcesEndpoint)
      .then((r) => r.json())
      .then((body) => {
        setSources((body.data ?? []) as CaptureSource[])
      })
      .catch(() => {})
  }, [captureSourcesEndpoint])

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
    const payload = {
      capturedFromId: selectedSourceId || undefined,
      defaultTags: defaultTags.length ? defaultTags : undefined,
      rows,
      dryRun,
    }
    const res = await fetch(contactsImportEndpoint, {
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
  const selectedSource = sources.find((s) => s.id === selectedSourceId)
  const readySteps = [
    fileName ? 'File selected' : 'Choose a CSV',
    rows.length > 0 ? `${rows.length} row${rows.length === 1 ? '' : 's'} parsed` : 'Parse rows',
    selectedSource ? 'Source attributed' : 'No source attribution',
    validateResult || importResult ? 'Validated' : 'Validate before import',
  ]

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">CRM</p>
          <h1 className="pib-page-title mt-2">CSV intake command center</h1>
          <p className="pib-page-sub max-w-2xl">
            Govern bulk CRM intake before records land in the database. Preview rows, apply source attribution, merge tags, and validate the import before any contacts are created or updated.
          </p>
        </div>
        <div>
          <Link
            href={captureSourcesHref}
            className="btn-pib-secondary !py-2 !px-4 !text-sm"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back to capture sources
          </Link>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <ImportStat
          label="Import readiness"
          value={rows.length > 0 && !parseError ? 'Ready' : 'Draft'}
          detail={parseError ? 'CSV needs review' : 'Validation controls import risk'}
          icon="rule_settings"
        />
        <ImportStat
          label="Rows parsed"
          value={rows.length}
          detail={fileName || 'No file selected'}
          icon="table_rows"
        />
        <ImportStat
          label="Attribution source"
          value={selectedSource ? selectedSource.name : 'Unassigned'}
          detail={selectedSource ? selectedSource.type : 'Optional but recommended'}
          icon="hub"
        />
        <ImportStat
          label="Validation gate"
          value={validateResult || importResult ? 'Checked' : 'Pending'}
          detail="Dry-run before final import"
          icon="verified"
        />
      </div>

      <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-4">
        <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Import path</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {readySteps.map((step, index) => (
            <div
              key={`${step}-${index}`}
              className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] px-3 py-2"
            >
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                Step {index + 1}
              </p>
              <p className="mt-1 text-sm text-[var(--color-pib-text)]">{step}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-pib-text)] mb-1.5">
            CSV file
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="block text-sm text-[var(--color-pib-text)] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-[var(--color-pib-line)] file:bg-[var(--color-pib-bg)] file:text-[var(--color-pib-text)] file:text-sm file:cursor-pointer"
          />
          {fileName && (
            <p className="mt-1.5 text-xs text-[var(--color-pib-text-muted)]">
              {fileName} — parsed {rows.length} row{rows.length === 1 ? '' : 's'}
            </p>
          )}
          {parseError && (
            <p className="mt-1.5 text-sm text-[#FCA5A5]">{parseError}</p>
          )}
          <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">
            Expected headers (case-insensitive): email (required), name or firstname/lastname, company, phone, tags (comma- or semicolon-separated), notes.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-pib-text)] mb-1.5">
            Default tags
          </label>
          <input
            type="text"
            value={defaultTagsRaw}
            onChange={(e) => setDefaultTagsRaw(e.target.value)}
            placeholder="e.g. q2-import, webinar-leads"
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm"
          />
          <p className="mt-1.5 text-xs text-[var(--color-pib-text-muted)]">
            Comma-separated. Applied to every imported contact in addition to per-row tags.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-pib-text)] mb-1.5">
            Capture source (optional)
          </label>
          <select
            value={selectedSourceId}
            onChange={(e) => setSelectedSourceId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm"
          >
            <option value="">(none)</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} - {s.type}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-[var(--color-pib-text-muted)]">
            If set, imported contacts will be tagged with the source&apos;s autoTags and the source&apos;s captured-count will be bumped by the number of newly created contacts.
          </p>
        </div>
      </div>

      {previewRows.length > 0 && (
        <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-4">
          <h2 className="text-sm font-medium text-[var(--color-pib-text)] mb-2">
            Preview (first {previewRows.length} of {rows.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-pib-line)]">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03]">
                <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
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
                    <tr key={i} className="border-t border-[var(--color-pib-line)] align-top">
                      <td className="px-3 py-2 font-mono text-xs text-[var(--color-pib-text)] break-all">
                        {r.email}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-pib-text)]">{name}</td>
                      <td className="px-3 py-2 text-[var(--color-pib-text)]">{r.company ?? ''}</td>
                      <td className="px-3 py-2 text-[var(--color-pib-text)]">{r.phone ?? ''}</td>
                      <td className="px-3 py-2 text-[var(--color-pib-text-muted)]">
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
            className="btn-pib-secondary !py-2 !px-4 !text-sm disabled:opacity-50"
          >
            {validating ? 'Validating...' : 'Validate (dry run)'}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={validating || importing}
            className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-50"
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
      )}

      {submitError && (
        <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-4 text-sm text-[#FCA5A5]">
          {submitError}
        </div>
      )}

      {validateResult && !importResult && (
        <ResultCard title="Validation result" result={validateResult} variant="dryrun" />
      )}

      {importResult && (
        <ResultCard title="Import complete" result={importResult} variant="done" />
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
    <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-4 space-y-3">
      <h2 className="text-sm font-medium text-[var(--color-pib-text)]">{title}</h2>
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
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1">
            Invalid rows
          </p>
          <ul className="space-y-1 text-sm text-[var(--color-pib-text)]">
            {result.invalidRows.slice(0, 50).map((r) => (
              <li key={r.index} className="font-mono text-xs">
                row {r.index}: {r.reason}
              </li>
            ))}
            {result.invalidRows.length > 50 && (
              <li className="text-xs text-[var(--color-pib-text-muted)]">
                ...and {result.invalidRows.length - 50} more
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
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] p-3">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
        {label}
      </p>
      <p className="text-2xl font-display text-[var(--color-pib-text)]">{value}</p>
    </div>
  )
}

function ImportStat({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: string | number
  detail: string
  icon: string
}) {
  return (
    <div className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            {label}
          </p>
          <p className="mt-2 truncate text-2xl font-display text-[var(--color-pib-text)]">
            {value}
          </p>
        </div>
        <span className="material-symbols-outlined rounded-lg border border-[var(--color-pib-line)] bg-white/[0.04] p-2 text-[18px] text-[var(--color-pib-text-muted)]">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">{detail}</p>
    </div>
  )
}
