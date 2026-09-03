'use client'

import { useState } from 'react'
import type { ClientDocument } from '@/lib/client-documents/types'

export function ShareSettingsPanel({
  document,
  baseUrl,
  onChange,
}: {
  document: ClientDocument
  baseUrl: string
  onChange: (next: ClientDocument) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function enableEditShare() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/client-documents/${document.id}/edit-share/enable`, {
        method: 'POST',
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error)
      onChange({
        ...document,
        editShareEnabled: true,
        editShareToken: body.data.editShareToken,
        editAccessCode: body.data.editAccessCode,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function regenerateCode() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/client-documents/${document.id}/edit-share/regenerate-code`,
        { method: 'POST' },
      )
      const body = await res.json()
      if (!body.success) throw new Error(body.error)
      onChange({ ...document, editAccessCode: body.data.editAccessCode })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function disableEditShare() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/client-documents/${document.id}/edit-share/disable`, {
        method: 'POST',
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error)
      onChange({ ...document, editShareEnabled: false })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const viewUrl =
    document.shareEnabled && document.shareToken ? `${baseUrl}/d/${document.shareToken}` : null
  const editUrl =
    document.editShareEnabled && document.editShareToken
      ? `${baseUrl}/d/${document.editShareToken}/edit`
      : null

  return (
    <section className="space-y-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-5">
      <h3 className="text-sm font-medium uppercase tracking-wider text-[var(--color-pib-text-muted)]">
        Share settings
      </h3>

      <div>
        <p className="text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)]">
          View-only link
        </p>
        {viewUrl ? (
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-xs">
              {viewUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(viewUrl)}
              className="text-xs text-[var(--color-pib-accent)] hover:underline"
            >
              Copy
            </button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            Publish the document to enable the public view link.
          </p>
        )}
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)]">
          Edit link (with auth + code)
        </p>
        {editUrl ? (
          <>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-xs">
                {editUrl}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(editUrl)}
                className="text-xs text-[var(--color-pib-accent)] hover:underline"
              >
                Copy
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)]">
                Access code
              </span>
              <code className="rounded bg-[var(--color-pib-accent-soft)] px-3 py-1 text-sm font-medium tracking-widest text-[var(--color-pib-accent)]">
                {document.editAccessCode}
              </code>
              <button
                disabled={busy}
                onClick={regenerateCode}
                className="text-xs text-[var(--color-pib-accent)] hover:underline disabled:opacity-50"
              >
                Regenerate
              </button>
            </div>
            <button
              disabled={busy}
              onClick={disableEditShare}
              className="mt-2 text-xs text-[var(--st-danger)] hover:underline disabled:opacity-50"
            >
              Disable edit link
            </button>
          </>
        ) : (
          <button
            disabled={busy}
            onClick={enableEditShare}
            className="mt-1 rounded-md border border-[var(--color-pib-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-2)] disabled:opacity-50"
          >
            Enable edit link
          </button>
        )}
      </div>

      {error && <p className="text-xs text-[var(--st-danger)]">{error}</p>}
    </section>
  )
}
