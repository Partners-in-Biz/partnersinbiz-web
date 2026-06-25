'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'
import { DocumentTheme } from '@/components/client-documents/theme/DocumentTheme'
import { SignatureCapture } from '@/components/client-documents/SignatureCapture'
import type { ClientDocument, ClientDocumentVersion } from '@/lib/client-documents/types'

interface SignatureRequestSummary {
  id: string
  signerName: string
  signerEmail: string
  message: string
  status: 'pending' | 'signed' | 'declined' | 'cancelled'
}

type State =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      document: ClientDocument
      version: ClientDocumentVersion
      request: SignatureRequestSummary
    }
  | { kind: 'signed' }
  | { kind: 'error'; message: string }

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

export default function SignDocumentPage({ params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = use(params)
  const searchParams = useSearchParams()
  const signToken = searchParams.get('st') ?? ''

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [signature, setSignature] = useState<{ dataUrl: string | null; typedName: string }>({
    dataUrl: null,
    typedName: '',
  })
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!signToken) {
      setState({ kind: 'error', message: 'This signing link is missing its signature token.' })
      return
    }
    try {
      const res = await fetch(`/api/v1/public/client-documents/${shareToken}/sign?st=${encodeURIComponent(signToken)}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
        setState({ kind: 'error', message: (data.error as string) || 'This signing link is not valid.' })
        return
      }
      const data = unwrap(body)
      const request = data?.signatureRequest as SignatureRequestSummary | undefined
      if (request?.status === 'signed') {
        setState({ kind: 'signed' })
        return
      }
      if (request?.status === 'cancelled' || request?.status === 'declined') {
        setState({ kind: 'error', message: 'This signature request is no longer active.' })
        return
      }
      setState({
        kind: 'ready',
        document: data?.document as ClientDocument,
        version: data?.version as ClientDocumentVersion,
        request: request as SignatureRequestSummary,
      })
    } catch {
      setState({ kind: 'error', message: 'Could not load the document. Please try again.' })
    }
  }, [shareToken, signToken])

  useEffect(() => {
    load()
  }, [load])

  async function handleSign() {
    if (state.kind !== 'ready') return
    if (!signature.dataUrl) {
      setSubmitError('Please draw or type your signature.')
      return
    }
    if (!signature.typedName.trim()) {
      setSubmitError('Please type your full name to confirm.')
      return
    }
    if (!agreed) {
      setSubmitError('Please tick the box to confirm you agree to sign.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/v1/public/client-documents/${shareToken}/sign?st=${encodeURIComponent(signToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typedName: signature.typedName.trim(),
          signatureImage: signature.dataUrl,
          agreed: true,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
        setSubmitError((data.error as string) || 'Could not record your signature.')
        return
      }
      setState({ kind: 'signed' })
    } catch {
      setSubmitError('Could not record your signature. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <DocumentTheme>
        <div className="grid min-h-screen place-items-center text-[var(--doc-muted)]">Loading…</div>
      </DocumentTheme>
    )
  }

  if (state.kind === 'error') {
    return (
      <DocumentTheme>
        <div className="mx-auto mt-32 max-w-sm px-6 text-center text-[var(--doc-text)]">
          <span className="material-symbols-outlined mb-2 text-3xl text-rose-400" aria-hidden>
            error
          </span>
          <p>{state.message}</p>
        </div>
      </DocumentTheme>
    )
  }

  if (state.kind === 'signed') {
    return (
      <DocumentTheme>
        <div className="mx-auto mt-32 max-w-sm px-6 text-center text-[var(--doc-text)]">
          <span className="material-symbols-outlined mb-2 text-4xl text-emerald-400" aria-hidden>
            verified
          </span>
          <h1 className="font-display text-2xl">Document signed</h1>
          <p className="mt-2 text-sm text-[var(--doc-muted)]">
            Thank you. Your electronic signature has been recorded and a copy has been saved.
          </p>
        </div>
      </DocumentTheme>
    )
  }

  const canSubmit = Boolean(signature.dataUrl) && signature.typedName.trim().length > 0 && agreed && !submitting

  return (
    <div className="min-h-screen bg-[#f4f4f5]">
      <DocumentRenderer document={state.document} version={state.version} />

      <div className="sticky bottom-0 z-10 border-t border-[var(--color-pib-line,#e5e7eb)] bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted,#6b7280)]">
            Signature requested for {state.request.signerName || 'you'}
          </p>
          <h2 className="mb-3 font-display text-xl text-[#111827]">Sign “{state.document.title}”</h2>
          {state.request.message ? (
            <p className="mb-4 rounded-lg bg-[#f9fafb] px-3 py-2 text-sm text-[#374151]">{state.request.message}</p>
          ) : null}

          <SignatureCapture
            defaultTypedName={state.request.signerName}
            onChange={setSignature}
          />

          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-[#374151]">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 accent-[var(--color-pib-accent,#111827)]"
            />
            <span>
              I, {state.request.signerName || 'the undersigned'}, agree that this electronic signature is the legal
              equivalent of my handwritten signature on this document.
            </span>
          </label>

          {submitError ? (
            <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {submitError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleSign}
            disabled={!canSubmit}
            className="mt-4 w-full rounded-lg bg-[#111827] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Sign document'}
          </button>
        </div>
      </div>
    </div>
  )
}
