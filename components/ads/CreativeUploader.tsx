'use client'
import { useState, useRef } from 'react'
import type { AdCreative } from '@/lib/ads/types'

interface Props {
  orgId: string
  /** Optional name pre-fill (e.g. derived from filename). */
  defaultName?: string
  /** Restrict accepted MIME types. */
  accept?: 'image' | 'video' | 'both'
  /** Called once finalize completes with the full AdCreative doc. */
  onUploaded?: (creative: AdCreative) => void
  /** Called on user cancel during idle state. */
  onCancel?: () => void
}

type State =
  | { kind: 'idle' }
  | { kind: 'previewing'; file: File; previewUrl: string; name: string }
  | { kind: 'uploading'; pct: number }
  | { kind: 'finalizing' }
  | { kind: 'done'; creative: AdCreative }
  | { kind: 'error'; message: string }

const MAX_BYTES = 100 * 1024 * 1024

function acceptString(a: 'image' | 'video' | 'both'): string {
  if (a === 'image') return 'image/*'
  if (a === 'video') return 'video/*'
  return 'image/*,video/*'
}

export function CreativeUploader({
  orgId,
  defaultName,
  accept = 'both',
  onUploaded,
  onCancel,
}: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)

  function handlePicked(file: File) {
    if (file.size > MAX_BYTES) {
      setState({ kind: 'error', message: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max 100 MB)` })
      return
    }
    setState({
      kind: 'previewing',
      file,
      previewUrl: URL.createObjectURL(file),
      name: defaultName ?? file.name.replace(/\.[^/.]+$/, ''),
    })
  }

  async function startUpload() {
    if (state.kind !== 'previewing') return
    const { file, name } = state
    setState({ kind: 'uploading', pct: 0 })
    try {
      // Step 1
      const urlRes = await fetch('/api/v1/ads/creatives/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify({ name, mimeType: file.type, fileSize: file.size }),
      })
      const urlBody = await urlRes.json()
      if (!urlBody.success) throw new Error(urlBody.error ?? `HTTP ${urlRes.status}`)
      const { creativeId, uploadUrl } = urlBody.data as { creativeId: string; uploadUrl: string }

      // Step 2 - PUT direct to GCS
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putRes.ok) throw new Error(`Storage upload failed: HTTP ${putRes.status}`)

      // Step 3 - finalize
      setState({ kind: 'finalizing' })
      const finRes = await fetch(`/api/v1/ads/creatives/${creativeId}/finalize`, {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
      })
      const finBody = await finRes.json()
      if (!finBody.success) throw new Error(finBody.error ?? `Finalize failed: HTTP ${finRes.status}`)
      const creative = finBody.data as AdCreative
      setState({ kind: 'done', creative })
      onUploaded?.(creative)
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message })
    }
  }

  function reset() {
    if (state.kind === 'previewing') URL.revokeObjectURL(state.previewUrl)
    setState({ kind: 'idle' })
  }

  return (
    <div className="space-y-3">
      {state.kind === 'idle' && (
        <div className="rounded-lg border-2 border-dashed border-white/10 p-6 text-center">
          <p className="text-sm text-white/60">Drop an image or video here, or</p>
          <button
            type="button"
            className="btn-pib-accent mt-3 text-sm"
            onClick={() => inputRef.current?.click()}
          >
            Choose a file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={acceptString(accept)}
            className="sr-only"
            data-impeccable-disable="content-invisible-at-rest"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handlePicked(f)
            }}
            aria-label="File input"
          />
          {onCancel && (
            <button type="button" className="ml-3 text-sm text-white/40 underline" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      )}

      {state.kind === 'previewing' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-white/10 p-3">
            {state.file.type.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={state.previewUrl} alt="Preview" className="max-h-64 rounded" />
            ) : (
              <video src={state.previewUrl} controls className="max-h-64 rounded" />
            )}
          </div>
          <label className="block text-sm">
            <span className="font-medium">Name</span>
            <input
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={state.name}
              onChange={(e) =>
                setState({ ...state, name: e.target.value })
              }
              aria-label="Creative name"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-pib-ghost text-sm" onClick={reset}>
              Cancel
            </button>
            <button type="button" className="btn-pib-accent text-sm" onClick={startUpload}>
              Upload
            </button>
          </div>
        </div>
      )}

      {state.kind === 'uploading' && (
        <div className="rounded-lg border border-white/10 p-4 text-sm text-white/60">
          Uploading to storage…
        </div>
      )}

      {state.kind === 'finalizing' && (
        <div className="rounded-lg border border-white/10 p-4 text-sm text-white/60">
          Processing - generating preview…
        </div>
      )}

      {state.kind === 'done' && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <p className="font-medium text-emerald-300">Uploaded successfully</p>
          <p className="text-xs text-white/40 mt-1">
            {state.creative.name} · {state.creative.width ?? '?'}×{state.creative.height ?? '?'}
          </p>
          <button type="button" className="btn-pib-ghost mt-3 text-xs" onClick={reset}>
            Upload another
          </button>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
          <p className="font-medium text-red-300">Upload failed</p>
          <p className="text-xs text-white/60 mt-1">{state.message}</p>
          <button type="button" className="btn-pib-ghost mt-3 text-xs" onClick={reset}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
