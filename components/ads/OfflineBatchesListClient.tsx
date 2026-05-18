'use client'
// components/ads/OfflineBatchesListClient.tsx
// Renders batch list + upload form. Upload → process → polls until terminal.

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { OfflineConversionBatch } from '@/lib/ads/offline-conversions/types'
import type { AdConversionAction } from '@/lib/ads/types'

interface Props {
  orgSlug: string
  orgId: string
  initialBatches: OfflineConversionBatch[]
  conversionActions: AdConversionAction[]
}

const STATUS_TINT: Record<string, string> = {
  queued: 'bg-yellow-500/10 text-yellow-300',
  processing: 'bg-blue-500/10 text-blue-300',
  completed: 'bg-green-500/10 text-green-300',
  failed: 'bg-red-500/10 text-red-300',
  partial: 'bg-orange-500/10 text-orange-300',
}

const TERMINAL = new Set(['completed', 'failed', 'partial'])

function formatTs(ts: { seconds: number } | undefined): string {
  if (!ts) return '—'
  return new Date(ts.seconds * 1000).toLocaleString()
}

export function OfflineBatchesListClient({
  orgSlug,
  orgId,
  initialBatches,
  conversionActions,
}: Props) {
  const router = useRouter()
  const [batches, setBatches] = useState<OfflineConversionBatch[]>(initialBatches)
  const [showForm, setShowForm] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedActionId, setSelectedActionId] = useState(conversionActions[0]?.id ?? '')
  const fileRef = useRef<HTMLInputElement>(null)
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  const pollBatch = useCallback(
    (batchId: string) => {
      if (pollTimers.current.has(batchId)) return
      const timer = setInterval(async () => {
        try {
          const res = await fetch(`/api/v1/ads/conversions/offline/batches/${batchId}`, {
            headers: { 'X-Org-Id': orgId },
          })
          const json = await res.json()
          if (!json.success) return
          const updated = json.data.batch as OfflineConversionBatch
          setBatches((prev) => prev.map((b) => (b.id === batchId ? updated : b)))
          if (TERMINAL.has(updated.status)) {
            clearInterval(timer)
            pollTimers.current.delete(batchId)
            router.refresh()
          }
        } catch {
          // swallow — will retry next tick
        }
      }, 2000)
      pollTimers.current.set(batchId, timer)
    },
    [orgId, router],
  )

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!fileRef.current?.files?.[0]) {
      setUploadError('Select a CSV file')
      return
    }
    if (!selectedActionId) {
      setUploadError('Select a conversion action')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', fileRef.current.files[0])
      form.append('conversionActionId', selectedActionId)

      const uploadRes = await fetch('/api/v1/ads/conversions/offline/upload', {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
        body: form,
      })
      const uploadJson = await uploadRes.json()
      if (!uploadJson.success) throw new Error(uploadJson.error ?? `HTTP ${uploadRes.status}`)

      const { batchId } = uploadJson.data as { batchId: string; totalRows: number }

      // Optimistically add to list
      setBatches((prev) => [
        {
          id: batchId,
          orgId,
          conversionActionId: selectedActionId,
          csvPath: '',
          status: 'queued',
          totalRows: uploadJson.data.totalRows,
          processedRows: 0,
          failedRows: 0,
          createdBy: '',
          createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as never,
          updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as never,
        },
        ...prev,
      ])
      setShowForm(false)
      if (fileRef.current) fileRef.current.value = ''

      // Auto-start processing
      fetch(`/api/v1/ads/conversions/offline/batches/${batchId}/process`, {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
      }).catch(() => undefined)

      // Start polling
      pollBatch(batchId)
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/50">
          {batches.length} {batches.length === 1 ? 'batch' : 'batches'}
        </p>
        <button
          type="button"
          className="btn-pib-accent text-sm"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : 'Upload CSV'}
        </button>
      </div>

      {/* Upload Form */}
      {showForm && (
        <form
          onSubmit={handleUpload}
          className="rounded-lg border border-white/10 bg-white/[0.02] p-5 space-y-4"
        >
          <h2 className="text-base font-medium">Upload offline conversion CSV</h2>

          <div className="space-y-1">
            <label className="text-sm text-white/60" htmlFor="csv-file">
              CSV file
            </label>
            <input
              id="csv-file"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-sm text-white/70 file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-sm file:text-white"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-white/60" htmlFor="action-select">
              Conversion action
            </label>
            <select
              id="action-select"
              className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={selectedActionId}
              onChange={(e) => setSelectedActionId(e.target.value)}
              required
            >
              {conversionActions.length === 0 && (
                <option value="">No conversion actions configured</option>
              )}
              {conversionActions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.platform})
                </option>
              ))}
            </select>
          </div>

          {uploadError && (
            <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {uploadError}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              className="btn-pib-accent text-sm"
              disabled={uploading || conversionActions.length === 0}
            >
              {uploading ? 'Uploading…' : 'Upload & Process'}
            </button>
            <button
              type="button"
              className="text-sm text-white/40 hover:text-white/70"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Batch list */}
      {batches.length === 0 ? (
        <p className="text-sm text-white/40">No batches yet. Upload a CSV to get started.</p>
      ) : (
        <div className="divide-y divide-white/5 rounded-lg border border-white/10">
          {batches.map((batch) => (
            <div key={batch.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-mono truncate text-white/80">{batch.id}</p>
                <p className="text-xs text-white/40 mt-0.5">{formatTs(batch.createdAt as { seconds: number })}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-white/50">
                  {batch.processedRows}/{batch.totalRows}
                  {batch.failedRows > 0 && (
                    <span className="text-red-400 ml-1">({batch.failedRows} failed)</span>
                  )}
                </span>
                <span
                  className={`text-xs rounded-full px-2 py-0.5 font-medium ${STATUS_TINT[batch.status] ?? 'bg-white/5 text-white/50'}`}
                >
                  {batch.status}
                </span>
                <a
                  href={`/admin/org/${orgSlug}/ads/conversions/offline/${batch.id}`}
                  className="text-xs text-white/40 hover:text-white/80 underline"
                >
                  Details
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
