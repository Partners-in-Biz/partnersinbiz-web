'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'
import { SignatureCapture } from '@/components/client-documents/SignatureCapture'
import type { ClientDocument, ClientDocumentVersion } from '@/lib/client-documents/types'
import { Button, Checkbox, Notice, Panel, Skeleton, Steps } from '@/components/studio'

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

const SIGN_STEPS = ['Review', 'Sign', 'Done'] as const

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
      <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-8 py-16">
        <Skeleton height={120} />
      </main>
    )
  }

  if (state.kind === 'error') {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-8 py-16">
        <Panel>
          <h1 className="sc-article__h2">Could not open signing link.</h1>
          <div className="mt-4">
            <Notice tone="danger">{state.message}</Notice>
          </div>
        </Panel>
      </main>
    )
  }

  if (state.kind === 'signed') {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-8 py-16">
        <Panel>
          <Steps steps={SIGN_STEPS} current={2} />
          <h1 className="sc-article__h2 mt-8">Document signed.</h1>
          <p className="sc-body mt-4">
            Thank you. Your electronic signature has been recorded and a copy has been saved.
          </p>
        </Panel>
      </main>
    )
  }

  const canSubmit = Boolean(signature.dataUrl) && signature.typedName.trim().length > 0 && agreed && !submitting

  return (
    <div>
      <DocumentRenderer document={state.document} version={state.version} />

      <div className="sticky bottom-0 z-10 border-t border-[var(--sc-line)] bg-[var(--sc-canvas)]">
        <div className="mx-auto max-w-2xl px-8 py-8">
          <Steps steps={SIGN_STEPS} current={1} />
          <p className="sc-tiny mt-8">
            Signature requested for {state.request.signerName || 'you'}
          </p>
          <h2 className="st-title mt-2">Sign {state.document.title}.</h2>
          {state.request.message ? (
            <div className="mt-4">
              <Notice>{state.request.message}</Notice>
            </div>
          ) : null}

          <div className="mt-4">
            <SignatureCapture
              defaultTypedName={state.request.signerName}
              onChange={setSignature}
            />
          </div>

          <div className="mt-4">
            <Checkbox
              label={`I, ${state.request.signerName || 'the undersigned'}, agree that this electronic signature is the legal equivalent of my handwritten signature on this document.`}
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
          </div>

          {submitError ? (
            <div className="mt-4">
              <Notice tone="danger">{submitError}</Notice>
            </div>
          ) : null}

          <div className="mt-4">
            <Button
              type="button"
              block
              onClick={handleSign}
              disabled={!canSubmit}
              loading={submitting}
            >
              Sign document
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
