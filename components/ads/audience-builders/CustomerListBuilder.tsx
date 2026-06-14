'use client'
import { useState, useRef } from 'react'
import type { AdCustomAudience } from '@/lib/ads/types'

interface Props {
  orgId: string
  onComplete?: (ca: AdCustomAudience) => void
  onCancel?: () => void
}

type State =
  | { kind: 'config' }
  | { kind: 'uploading'; step: 'create' | 'upload' }
  | { kind: 'done'; ca: AdCustomAudience }
  | { kind: 'error'; message: string }

const MAX_CSV_SIZE = 50 * 1024 * 1024 // 50 MB

export function CustomerListBuilder({ orgId, onComplete, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<string[][]>([])
  const [emailColumn, setEmailColumn] = useState<string>('')
  const [phoneColumn, setPhoneColumn] = useState<string>('')
  const [state, setState] = useState<State>({ kind: 'config' })
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(f: File) {
    if (f.size > MAX_CSV_SIZE) {
      setState({ kind: 'error', message: `File too large (${(f.size / 1024 / 1024).toFixed(1)} MB, max 50 MB)` })
      return
    }
    const text = await f.text()
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).slice(0, 6)
    if (lines.length < 2) {
      setState({ kind: 'error', message: 'CSV must have a header row + at least 1 data row' })
      return
    }
    const hdrs = lines[0].split(',').map((h) => h.trim())
    const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim()))
    setFile(f)
    setHeaders(hdrs)
    setPreviewRows(rows)
    // Auto-detect: pick first header containing 'email' or 'phone'
    const eIdx = hdrs.findIndex((h) => /email/i.test(h))
    const pIdx = hdrs.findIndex((h) => /phone|mobile|cell/i.test(h))
    if (eIdx !== -1) setEmailColumn(hdrs[eIdx])
    if (pIdx !== -1) setPhoneColumn(hdrs[pIdx])
  }

  function canSubmit(): boolean {
    return name.trim().length > 0 && file != null && (emailColumn !== '' || phoneColumn !== '')
  }

  async function submit() {
    if (!canSubmit() || !file) return
    setState({ kind: 'uploading', step: 'create' })
    try {
      // Step 1 — create local CA + Meta sync
      const createRes = await fetch('/api/v1/ads/custom-audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify({
          input: {
            type: 'CUSTOMER_LIST',
            name,
            description,
            status: 'BUILDING',
            source: {
              kind: 'CUSTOMER_LIST',
              csvStoragePath: '',  // Phase 4: not persisting CSV to Storage; server uses request body directly
              hashCount: 0,
              uploadedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
            },
          },
        }),
      })
      const createBody = await createRes.json()
      if (!createBody.success) throw new Error(createBody.error ?? `Create failed: HTTP ${createRes.status}`)
      const ca = createBody.data as AdCustomAudience

      // Step 2 — upload list
      setState({ kind: 'uploading', step: 'upload' })
      const columns: string[] = []
      const headerLookup: string[] = []  // for reordering CSV columns to match `columns` order if needed
      if (emailColumn) { columns.push('EMAIL'); headerLookup.push(emailColumn) }
      if (phoneColumn) { columns.push('PHONE'); headerLookup.push(phoneColumn) }

      // Rebuild CSV with only the picked columns in the right order
      // (Server expects columns in `columns` order; we send a reordered CSV)
      const allText = await file.text()
      const allLines = allText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
      const fullHeader = allLines[0].split(',').map((h) => h.trim())
      const colIndices = headerLookup.map((h) => fullHeader.indexOf(h))
      const filteredCsv = [
        columns.join(','),
        ...allLines.slice(1).map((line) => {
          const cells = line.split(',')
          return colIndices.map((i) => (cells[i] ?? '').trim()).join(',')
        }),
      ].join('\n')

      const blob = new Blob([filteredCsv], { type: 'text/csv' })
      const form = new FormData()
      form.append('file', blob, 'customer-list.csv')
      form.append('columns', JSON.stringify(columns))

      const uploadRes = await fetch(`/api/v1/ads/custom-audiences/${ca.id}/upload-list`, {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
        body: form,
      })
      const uploadBody = await uploadRes.json()
      if (!uploadBody.success) throw new Error(uploadBody.error ?? `Upload failed: HTTP ${uploadRes.status}`)
      const finalCa = uploadBody.data as AdCustomAudience
      setState({ kind: 'done', ca: finalCa })
      onComplete?.(finalCa)
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message })
    }
  }

  function reset() {
    setName('')
    setDescription('')
    setFile(null)
    setHeaders([])
    setPreviewRows([])
    setEmailColumn('')
    setPhoneColumn('')
    setState({ kind: 'config' })
  }

  if (state.kind === 'done') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium text-emerald-300">Custom audience created</p>
        <p className="mt-1 text-xs text-white/60">
          {state.ca.name} — Meta is matching the approved list. Refresh size after a few minutes.
        </p>
        <button className="btn-pib-ghost mt-3 text-xs" onClick={reset}>
          Create another
        </button>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
        <p className="font-medium text-red-300">Upload failed</p>
        <p className="mt-1 text-xs text-white/60">{state.message}</p>
        <button className="btn-pib-ghost mt-3 text-xs" onClick={reset}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <label className="block text-sm">
        <span className="font-medium">Audience name</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Audience name"
          disabled={state.kind === 'uploading'}
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">Description (optional)</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
          disabled={state.kind === 'uploading'}
        />
      </label>

      <div className="space-y-2">
        <label className="block text-sm font-medium">CSV file</label>
        {!file ? (
          <div className="rounded-lg border-2 border-dashed border-white/10 p-6 text-center">
            <p className="text-sm text-white/60">CSV with email and/or phone columns</p>
            <button
              type="button"
              className="btn-pib-accent mt-3 text-sm"
              onClick={() => inputRef.current?.click()}
            >
              Choose CSV
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
              aria-label="CSV file"
            />
          </div>
        ) : (
          <div className="rounded border border-white/10 p-3">
            <div className="flex items-center justify-between text-sm">
              <span>{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
              <button type="button" className="text-xs text-white/40 underline" onClick={() => setFile(null)}>
                Remove
              </button>
            </div>
            {headers.length > 0 && (
              <>
                <div className="mt-3 overflow-x-auto text-xs">
                  <table className="w-full">
                    <thead>
                      <tr>
                        {headers.map((h) => (
                          <th key={h} className="border-b border-white/10 px-2 py-1 text-left text-white/60">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 5).map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j} className="border-b border-white/5 px-2 py-1 text-white/40">
                              {cell || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-white/40">First 5 rows shown</p>
              </>
            )}
          </div>
        )}
      </div>

      {file && headers.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-medium">Email column</span>
            <select
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={emailColumn}
              onChange={(e) => setEmailColumn(e.target.value)}
              aria-label="Email column"
              disabled={state.kind === 'uploading'}
            >
              <option value="">— None —</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium">Phone column</span>
            <select
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={phoneColumn}
              onChange={(e) => setPhoneColumn(e.target.value)}
              aria-label="Phone column"
              disabled={state.kind === 'uploading'}
            >
              <option value="">— None —</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <p className="text-xs text-white/40">
        Server-side: lowercase + trim + SHA-256 → Meta CA Hash API. Raw PII never persisted.
      </p>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className="btn-pib-ghost text-sm" onClick={onCancel} disabled={state.kind === 'uploading'}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn-pib-accent text-sm"
          onClick={submit}
          disabled={!canSubmit() || state.kind === 'uploading'}
        >
          {state.kind === 'uploading'
            ? state.step === 'create'
              ? 'Creating…'
              : 'Uploading list…'
            : 'Create audience'}
        </button>
      </div>
    </div>
  )
}
