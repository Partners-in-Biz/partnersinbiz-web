// app/(portal)/portal/settings/data-export/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type ExportJob = {
  id: string
  status: string
  scope: string
  requestedBy: string
  downloadUrl: string | null
  sizeBytes: number | null
  totalRecords: number | null
  error: string | null
  createdAt: string | null
  completedAt: string | null
}

type ListResponse = { data?: { exports: ExportJob[]; count: number }; error?: string }
type CreateResponse = { data?: { id: string; status: string; downloadUrl: string; totalRecords: number }; error?: string }

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function StatusPill({ status }: { status: string }) {
  if (status === 'complete') {
    return <span className="pib-pill-success inline-flex items-center gap-1">
      <span className="material-symbols-outlined text-[14px]">check_circle</span>Complete
    </span>
  }
  if (status === 'failed') {
    return <span className="pib-pill !text-red-400 inline-flex items-center gap-1">
      <span className="material-symbols-outlined text-[14px]">error</span>Failed
    </span>
  }
  return <span className="pib-pill inline-flex items-center gap-1">
    <span className="material-symbols-outlined text-[14px] animate-pulse">hourglass_top</span>Processing
  </span>
}

export default function DataExportPage() {
  const searchParams = useSearchParams()
  const scope = scopeFromSearchParams(searchParams)
  const endpoint = useMemo(() => scopedApiPath('/api/v1/org/data-export', scope), [scope])

  const [exports, setExports] = useState<ExportJob[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const loadExports = useCallback(async () => {
    try {
      const res = await fetch(endpoint)
      const body = (await res.json().catch(() => ({}))) as ListResponse
      if (!res.ok) throw new Error(body.error ?? 'Failed to load exports')
      setExports(body.data?.exports ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exports')
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    setLoading(true)
    loadExports()
  }, [loadExports])

  async function startExport() {
    setExporting(true)
    setError('')
    try {
      const res = await fetch(endpoint, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as CreateResponse
      if (!res.ok) throw new Error(body.error ?? 'Export failed')
      await loadExports()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Security &amp; compliance</p>
        <h1 className="pib-page-title mt-2">Data export</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Export all of your organisation&apos;s data — contacts, companies, deals, projects, activity and more — as a single
          GDPR-compliant JSON file. Your data is yours.
        </p>
      </div>

      <div className="pib-card space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--color-pib-text)]">Export all data</p>
            <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
              Generates a downloadable archive of every record we hold for your organisation.
            </p>
          </div>
          <button type="button" onClick={startExport} disabled={exporting} className="pib-btn-primary shrink-0 disabled:opacity-60 inline-flex items-center gap-1.5">
            {exporting ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-pulse">hourglass_top</span>
                Preparing export...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">download</span>
                Export all data
              </>
            )}
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)]">Previous exports</h2>
        <div className="pib-card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] text-left text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  <th className="px-4 py-3 font-medium">Requested</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Records</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">Download</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-[var(--color-pib-line)]">
                      <td className="px-4 py-3" colSpan={5}>
                        <div className="h-4 w-full max-w-md rounded bg-[var(--color-pib-surface-soft)]" />
                      </td>
                    </tr>
                  ))
                ) : exports.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center">
                      <span className="material-symbols-outlined text-3xl text-[var(--color-pib-text-muted)]">cloud_download</span>
                      <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">No exports yet. Generate your first export above.</p>
                    </td>
                  </tr>
                ) : (
                  exports.map((job) => (
                    <tr key={job.id} className="border-b border-[var(--color-pib-line)] last:border-0 align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-[var(--color-pib-text-muted)]">
                        {job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={job.status} />
                        {job.status === 'failed' && job.error && (
                          <div className="mt-1 text-xs text-red-400">{job.error}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-pib-text)]">{job.totalRecords ?? '—'}</td>
                      <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">{formatBytes(job.sizeBytes)}</td>
                      <td className="px-4 py-3">
                        {job.downloadUrl ? (
                          <a
                            href={job.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[var(--color-pib-accent)] hover:underline"
                          >
                            <span className="material-symbols-outlined text-[16px]">download</span>
                            Download
                          </a>
                        ) : (
                          <span className="text-[var(--color-pib-text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
