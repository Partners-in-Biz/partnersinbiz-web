'use client'

import { useEffect, useRef, useState } from 'react'

type CommerceKind = 'invoice' | 'quote'

function htmlPath(kind: CommerceKind, id: string, orgId?: string) {
  const base = kind === 'invoice'
    ? `/api/v1/invoices/${encodeURIComponent(id)}/html`
    : `/api/v1/quotes/${encodeURIComponent(id)}/html`
  if (!orgId?.trim()) return base
  return `${base}?orgId=${encodeURIComponent(orgId.trim())}`
}

export function CommerceDocumentContextPreview({
  kind,
  documentId,
  orgId,
}: {
  kind: CommerceKind
  documentId: string
  orgId?: string
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    const headers: Record<string, string> = { Accept: 'text/html' }
    if (orgId?.trim()) headers['X-Org-Id'] = orgId.trim()
    fetch(htmlPath(kind, documentId, orgId), {
      signal: controller.signal,
      credentials: 'include',
      headers,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${kind} preview unavailable`)
        const html = await response.text()
        if (controller.signal.aborted) return
        const iframe = iframeRef.current
        if (!iframe) throw new Error('Preview frame missing')
        const doc = iframe.contentDocument
        if (!doc) throw new Error('Preview document unavailable')
        doc.open()
        doc.write(html)
        doc.close()
        setState('ready')
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        void cause
        setState('error')
      })
    return () => controller.abort()
  }, [documentId, kind, orgId])

  const label = kind === 'invoice' ? 'Invoice' : 'Quote'

  if (state === 'error') {
    return (
      <div role="status" className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-4 text-xs text-amber-100">
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
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
          {label} preview
        </h3>
        {state === 'loading' && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-pib-text-muted)]">
            <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
            Loading…
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-white">
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

export function InvoiceContextPreview({ invoiceId, orgId }: { invoiceId: string; orgId?: string }) {
  return <CommerceDocumentContextPreview kind="invoice" documentId={invoiceId} orgId={orgId} />
}

export function QuoteContextPreview({ quoteId, orgId }: { quoteId: string; orgId?: string }) {
  return <CommerceDocumentContextPreview kind="quote" documentId={quoteId} orgId={orgId} />
}
