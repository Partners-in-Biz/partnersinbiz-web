'use client'
// components/ads/OfflineBatchDetailClient.tsx
// Detail view: batch summary + paginated row table + Retry Failed button.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OfflineConversionBatch, OfflineConversionRow } from '@/lib/ads/offline-conversions/types'

interface Props {
  orgSlug: string
  orgId: string
  batch: OfflineConversionBatch
  initialRows: OfflineConversionRow[]
}

const STATUS_TINT: Record<string, string> = {
  queued: 'bg-yellow-500/10 text-yellow-300',
  processing: 'bg-blue-500/10 text-blue-300',
  completed: 'bg-green-500/10 text-green-300',
  failed: 'bg-red-500/10 text-red-300',
  partial: 'bg-orange-500/10 text-orange-300',
}

const ROW_STATUS_TINT: Record<string, string> = {
  pending: 'text-yellow-400',
  sent: 'text-green-400',
  failed: 'text-red-400',
  skipped: 'text-white/40',
}

function formatTs(ts: { seconds: number } | undefined): string {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleString()
}

const PAGE_SIZE = 25

export function OfflineBatchDetailClient({ orgSlug, orgId, batch: initialBatch, initialRows }: Props) {
  const router = useRouter()
  const [batch, setBatch] = useState(initialBatch)
  const [rows] = useState<OfflineConversionRow[]>(initialRows)
  const [page, setPage] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [retryResult, setRetryResult] = useState<string | null>(null)

  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const hasFailed = batch.failedRows > 0

  async function handleRetry() {
    setRetrying(true)
    setRetryError(null)
    setRetryResult(null)
    try {
      const res = await fetch(`/api/v1/ads/conversions/offline/batches/${batch.id}/retry-failed`, {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? `HTTP ${res.status}`)
      const d = json.data as { resolved: number; stillFailed: number; status: string }
      setRetryResult(`Retry complete: ${d.resolved} resolved, ${d.stillFailed} still failed`)
      setBatch((b) => ({
        ...b,
        status: d.status as OfflineConversionBatch['status'],
        processedRows: b.processedRows + d.resolved,
        failedRows: d.stillFailed,
      }))
      router.refresh()
    } catch (err) {
      setRetryError((err as Error).message)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-white/40 mb-1">Status</p>
            <span
              className={`text-sm rounded-full px-2 py-0.5 font-medium ${STATUS_TINT[batch.status] ?? 'bg-white/5 text-white/50'}`}
            >
              {batch.status}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/40">Rows</p>
            <p className="text-sm">
              {batch.processedRows}/{batch.totalRows}
              {batch.failedRows > 0 && (
                <span className="text-red-400 ml-2">({batch.failedRows} failed)</span>
              )}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-white/40">Created</p>
            <p>{formatTs(batch.createdAt as { seconds: number })}</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Completed</p>
            <p>{formatTs(batch.completedAt as { seconds: number } | undefined)}</p>
          </div>
        </div>
        {batch.errorMessage && (
          <p className="text-sm text-red-300 border border-red-500/20 rounded px-3 py-2 bg-red-500/5">
            {batch.errorMessage}
          </p>
        )}
      </div>

      {/* Retry button */}
      {hasFailed && (
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="btn-pib-accent text-sm"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? 'Retrying…' : `Retry ${batch.failedRows} failed rows`}
          </button>
          {retryResult && <p className="text-sm text-green-400">{retryResult}</p>}
          {retryError && <p className="text-sm text-red-400">{retryError}</p>}
        </div>
      )}

      {/* Row table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-medium">
            Rows ({rows.length})
          </h2>
          <a
            href={`/admin/org/${orgSlug}/ads/conversions/offline`}
            className="text-xs text-white/40 hover:text-white/70 underline"
          >
            ← Back to batches
          </a>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-white/40">No rows found.</p>
        ) : (
          <>
            <div className="rounded-lg border border-white/10 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-white/10">
                  <tr className="text-left text-white/40">
                    <th className="px-3 py-2 font-normal">Event ID</th>
                    <th className="px-3 py-2 font-normal">Time</th>
                    <th className="px-3 py-2 font-normal">Email</th>
                    <th className="px-3 py-2 font-normal">Phone</th>
                    <th className="px-3 py-2 font-normal">Value</th>
                    <th className="px-3 py-2 font-normal">Status</th>
                    <th className="px-3 py-2 font-normal">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {pageRows.map((row) => (
                    <tr key={row.id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 font-mono truncate max-w-[140px]">{row.eventId}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.eventTimeIso}</td>
                      <td className="px-3 py-2 truncate max-w-[140px]">{row.email ?? '—'}</td>
                      <td className="px-3 py-2">{row.phone ?? '—'}</td>
                      <td className="px-3 py-2">
                        {row.value != null ? `${row.value} ${row.currency ?? ''}`.trim() : '—'}
                      </td>
                      <td className={`px-3 py-2 font-medium ${ROW_STATUS_TINT[row.status] ?? ''}`}>
                        {row.status}
                      </td>
                      <td className="px-3 py-2 text-red-300 truncate max-w-[180px]">
                        {row.errorMessage ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center gap-3 mt-3">
                <button
                  type="button"
                  className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  ← Prev
                </button>
                <span className="text-xs text-white/40">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  type="button"
                  className="text-xs text-white/40 hover:text-white/70 disabled:opacity-30"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
