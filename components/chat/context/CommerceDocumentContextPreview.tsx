'use client'

import { Icon } from '@/components/studio'
import { useEffect, useRef, useState } from 'react'

type CommerceKind = 'invoice' | 'quote'

type CommerceMeta = {
  number: string
  status: string
  recipientEmail?: string
}

function withOrg(path: string, orgId?: string) {
  if (!orgId?.trim()) return path
  return `${path}?orgId=${encodeURIComponent(orgId.trim())}`
}

function htmlPath(kind: CommerceKind, id: string, orgId?: string) {
  return withOrg(
    kind === 'invoice'
      ? `/api/v1/invoices/${encodeURIComponent(id)}/html`
      : `/api/v1/quotes/${encodeURIComponent(id)}/html`,
    orgId,
  )
}

function pdfPath(kind: CommerceKind, id: string, orgId?: string) {
  return withOrg(
    kind === 'invoice'
      ? `/api/v1/invoices/${encodeURIComponent(id)}/pdf`
      : `/api/v1/quotes/${encodeURIComponent(id)}/pdf`,
    orgId,
  )
}

function sendPath(kind: CommerceKind, id: string, orgId?: string) {
  return withOrg(
    kind === 'invoice'
      ? `/api/v1/invoices/${encodeURIComponent(id)}/send`
      : `/api/v1/quotes/${encodeURIComponent(id)}/send`,
    orgId,
  )
}

function metaPath(kind: CommerceKind, id: string, orgId?: string) {
  return withOrg(
    kind === 'invoice'
      ? `/api/v1/invoices/${encodeURIComponent(id)}`
      : `/api/v1/quotes/${encodeURIComponent(id)}`,
    orgId,
  )
}

function authHeaders(orgId?: string, extra?: Record<string, string>): Record<string, string> {
  const headers = { ...(extra ?? {}) }
  if (orgId?.trim()) headers['X-Org-Id'] = orgId.trim()
  return headers
}

function parseMeta(kind: CommerceKind, body: Record<string, unknown>): CommerceMeta {
  const raw = (body.data ?? body) as Record<string, unknown>
  const record = kind === 'quote' && raw.quote && typeof raw.quote === 'object'
    ? raw.quote as Record<string, unknown>
    : raw
  const client = record.clientDetails && typeof record.clientDetails === 'object' && !Array.isArray(record.clientDetails)
    ? record.clientDetails as Record<string, unknown>
    : {}
  const number = kind === 'invoice'
    ? (typeof record.invoiceNumber === 'string' ? record.invoiceNumber : 'Invoice')
    : (typeof record.quoteNumber === 'string' ? record.quoteNumber : 'Quote')
  const recipientEmail = typeof client.email === 'string' && client.email.trim()
    ? client.email.trim()
    : typeof record.recipientEmail === 'string' && record.recipientEmail.trim()
      ? record.recipientEmail.trim()
      : undefined
  return {
    number,
    status: typeof record.status === 'string' ? record.status : 'draft',
    recipientEmail,
  }
}

export function CommerceDocumentContextPreview({
  kind,
  documentId,
  orgId,
  refreshRevision = 0,
}: {
  kind: CommerceKind
  documentId: string
  orgId?: string
  refreshRevision?: number
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [meta, setMeta] = useState<CommerceMeta | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [softRefreshing, setSoftRefreshing] = useState(false)
  const loadedKeyRef = useRef<string | null>(null)
  const loadKey = `${kind}:${documentId}:${orgId ?? ''}`

  useEffect(() => {
    loadedKeyRef.current = null
  }, [loadKey])

  useEffect(() => {
    const controller = new AbortController()
    const initial = loadedKeyRef.current !== loadKey
    if (initial) {
      setState('loading')
      setMeta(null)
    } else {
      setSoftRefreshing(true)
    }
    setConfirmSend(false)
    setActionMessage(null)
    setActionError(null)

    Promise.all([
      fetch(htmlPath(kind, documentId, orgId), {
        signal: controller.signal,
        credentials: 'include',
        headers: authHeaders(orgId, { Accept: 'text/html' }),
      }),
      fetch(metaPath(kind, documentId, orgId), {
        signal: controller.signal,
        credentials: 'include',
        headers: authHeaders(orgId, { Accept: 'application/json' }),
      }),
    ])
      .then(async ([htmlResponse, metaResponse]) => {
        if (!htmlResponse.ok) throw new Error(`${kind} preview unavailable`)
        const html = await htmlResponse.text()
        if (controller.signal.aborted) return
        const iframe = iframeRef.current
        if (!iframe) throw new Error('Preview frame missing')
        const doc = iframe.contentDocument
        if (!doc) throw new Error('Preview document unavailable')
        doc.open()
        doc.write(html)
        doc.close()

        if (metaResponse.ok) {
          const body = await metaResponse.json() as Record<string, unknown>
          setMeta(parseMeta(kind, body))
        }
        setState('ready')
        loadedKeyRef.current = loadKey
        setSoftRefreshing(false)
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        void cause
        setSoftRefreshing(false)
        if (initial) setState('error')
      })
    return () => controller.abort()
  }, [documentId, kind, loadKey, orgId, refreshRevision])

  const label = kind === 'invoice' ? 'Invoice' : 'Quote'
  const canSend = meta?.status === 'draft' && Boolean(meta.recipientEmail)

  async function handleDownloadPdf() {
    setDownloading(true)
    setActionError(null)
    try {
      const response = await fetch(pdfPath(kind, documentId, orgId), {
        credentials: 'include',
        headers: authHeaders(orgId, { Accept: 'application/pdf' }),
      })
      if (!response.ok) throw new Error('PDF download failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${meta?.number ?? kind}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setActionMessage('PDF downloaded.')
    } catch {
      setActionError('Could not download the PDF. Try again or open the full workspace.')
    } finally {
      setDownloading(false)
    }
  }

  async function handleSend() {
    if (!meta?.recipientEmail) return
    setSending(true)
    setActionError(null)
    setActionMessage(null)
    try {
      const response = await fetch(sendPath(kind, documentId, orgId), {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(orgId, { Accept: 'application/json', 'Content-Type': 'application/json' }),
      })
      const body = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        const error = typeof body.error === 'string' ? body.error : `Could not send ${label.toLowerCase()}`
        throw new Error(error)
      }
      const data = (body.data ?? body) as Record<string, unknown>
      const emailed = data.emailed !== false
      setMeta((current) => current ? { ...current, status: 'sent' } : current)
      setConfirmSend(false)
      setActionMessage(
        emailed
          ? `Sent to ${meta.recipientEmail} with PDF attached.`
          : `Marked as sent. Email to ${meta.recipientEmail} may still be delivering - check if needed.`,
      )
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : `Could not send ${label.toLowerCase()}`)
    } finally {
      setSending(false)
    }
  }

  if (state === 'error') {
    return (
      <div role="status" className="rounded-[6px] border border-amber-400/20 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-3 py-4 text-xs text-[var(--st-warning)]">
        The {label.toLowerCase()} preview is unavailable. Open the full workspace to continue.
      </div>
    )
  }

  return (
    <section
      data-testid={`context-${kind}-preview`}
      aria-label={`${label} document preview`}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
          {label} preview
        </h3>
        {(state === 'loading' || softRefreshing) && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-pib-text-muted)]">
            <Icon name="progress_activity" className="animate-spin text-[14px]" />
            {state === 'loading' ? 'Loading…' : 'Updating…'}
          </span>
        )}
      </div>

      {state === 'ready' && (
        <div className="flex flex-wrap gap-2" data-testid={`context-${kind}-actions`}>
          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            disabled={downloading}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--color-card-border)] px-3 text-[11px] font-medium text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-muted)] disabled:opacity-50 xl:min-h-8"
          >
            <Icon name="picture_as_pdf" className="text-[15px]" />
            {downloading ? 'Downloading…' : 'Download PDF'}
          </button>
          {meta?.status === 'draft' && (
            <button
              type="button"
              onClick={() => {
                setConfirmSend(true)
                setActionError(null)
              }}
              disabled={!canSend || sending}
              title={!meta.recipientEmail ? `Add a client email on this ${label.toLowerCase()} before sending` : undefined}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:opacity-50 xl:min-h-8"
            >
              <Icon name="send" className="text-[15px]" />
              Send email
            </button>
          )}
          {meta?.status === 'sent' && (
            <span className="inline-flex min-h-11 items-center rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 text-[11px] text-emerald-100 xl:min-h-8">
              Sent
            </span>
          )}
        </div>
      )}

      {confirmSend && meta?.recipientEmail && (
        <div
          role="dialog"
          aria-label={`Confirm send ${label.toLowerCase()}`}
          className="rounded-[6px] border border-primary/25 bg-primary/[0.06] p-3 space-y-2"
        >
          <p className="text-xs text-[var(--color-pib-text)]">
            Email <strong>{meta.number}</strong> to <strong>{meta.recipientEmail}</strong> with the PDF attached?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-[11px] font-medium text-black disabled:opacity-50 xl:min-h-8"
            >
              {sending ? 'Sending…' : 'Confirm & send'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmSend(false)}
              disabled={sending}
              className="inline-flex min-h-11 items-center rounded-lg border border-[var(--color-card-border)] px-3 text-[11px] text-[var(--color-pib-text-muted)] xl:min-h-8"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {actionMessage && (
        <p role="status" className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
          {actionMessage}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          {actionError}
        </p>
      )}
      {state === 'ready' && meta?.status === 'draft' && !meta.recipientEmail && (
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">
          Add a client email on this {label.toLowerCase()} to enable Send.
        </p>
      )}

      <div className="overflow-hidden rounded-[6px] border border-[var(--color-card-border)] bg-white">
        <iframe
          ref={iframeRef}
          title={`${label} preview`}
          className="block w-full border-0 bg-white"
          style={{ height: 'min(58dvh, 720px)', minHeight: '320px' }}
          sandbox="allow-same-origin"
        />
      </div>
    </section>
  )
}

export function InvoiceContextPreview({
  invoiceId,
  orgId,
  refreshRevision = 0,
}: {
  invoiceId: string
  orgId?: string
  refreshRevision?: number
}) {
  return (
    <CommerceDocumentContextPreview
      kind="invoice"
      documentId={invoiceId}
      orgId={orgId}
      refreshRevision={refreshRevision}
    />
  )
}

export function QuoteContextPreview({
  quoteId,
  orgId,
  refreshRevision = 0,
}: {
  quoteId: string
  orgId?: string
  refreshRevision?: number
}) {
  return (
    <CommerceDocumentContextPreview
      kind="quote"
      documentId={quoteId}
      orgId={orgId}
      refreshRevision={refreshRevision}
    />
  )
}
