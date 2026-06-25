'use client'

import { useCallback, useEffect, useState } from 'react'

import { fmtTimestamp } from '@/lib/format/timestamp'

/** Local shape — mirrors the SignatureRequest stored under the document. */
interface SignatureRequestRow {
  id: string
  signerName: string
  signerEmail: string
  message?: string
  status: 'pending' | 'signed' | 'declined' | 'cancelled'
  pdfSnapshotUrl?: string
  createdAt?: unknown
  signedAt?: unknown
}

export interface SignatureRequestPanelProps {
  documentId: string
  /** Whether the document has a published version + an enabled share link. */
  canRequest: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function unwrap<T>(body: unknown): T | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return ((b.data as T) ?? (b as T)) ?? null
}

function StatusBadge({ status }: { status: SignatureRequestRow['status'] }) {
  const map: Record<SignatureRequestRow['status'], { label: string; cls: string; icon: string }> = {
    signed: { label: 'Signed', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: 'verified' },
    pending: { label: 'Pending', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: 'schedule' },
    declined: { label: 'Declined', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', icon: 'block' },
    cancelled: { label: 'Cancelled', cls: 'bg-white/5 text-on-surface-variant border-white/10', icon: 'cancel' },
  }
  const m = map[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${m.cls}`}>
      <span className="material-symbols-outlined text-[13px]" aria-hidden>
        {m.icon}
      </span>
      {m.label}
    </span>
  )
}

export function SignatureRequestPanel({ documentId, canRequest }: SignatureRequestPanelProps) {
  const [requests, setRequests] = useState<SignatureRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/client-documents/${documentId}/signature-requests`)
      if (!res.ok) {
        setLoading(false)
        return
      }
      const body = await res.json().catch(() => null)
      const list = unwrap<SignatureRequestRow[]>(body)
      setRequests(Array.isArray(list) ? list : [])
    } catch {
      // best-effort
    } finally {
      setLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    load()
  }, [load])

  async function handleSend() {
    setError(null)
    setNotice(null)
    if (!signerName.trim()) return setError('Signer name is required.')
    if (!EMAIL_RE.test(signerEmail.trim())) return setError('Enter a valid email address.')
    setSending(true)
    try {
      const res = await fetch(`/api/v1/client-documents/${documentId}/signature-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signerEmail: signerEmail.trim(),
          message: message.trim(),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
        setError((data.error as string) || 'Could not send the signature request.')
        return
      }
      const data = unwrap<{ emailSent?: boolean }>(body)
      setNotice(data?.emailSent ? 'Signature request sent.' : 'Request created — but the invite email could not be sent.')
      setSignerName('')
      setSignerEmail('')
      setMessage('')
      setShowForm(false)
      await load()
    } catch {
      setError('Could not send the signature request.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="pib-card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.18em] text-on-surface-variant">E-signature</p>
        {canRequest && !showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/5"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden>
              edit_document
            </span>
            Request signature
          </button>
        ) : null}
      </div>

      {!canRequest ? (
        <p className="text-xs text-on-surface-variant">
          Publish a version and enable the share link to request a signature.
        </p>
      ) : null}

      {notice ? <p className="text-xs text-emerald-300">{notice}</p> : null}

      {showForm ? (
        <div className="space-y-2">
          <input
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Signer name"
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          />
          <input
            type="email"
            value={signerEmail}
            onChange={(e) => setSignerEmail(e.target.value)}
            placeholder="signer@example.com"
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Optional message to the signer"
            rows={2}
            className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          />
          {error ? <p className="text-xs text-rose-300">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setError(null)
              }}
              className="flex-1 rounded-md border border-white/10 px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="flex-1 rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--color-pib-accent)', color: '#000' }}
            >
              {sending ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-on-surface-variant">Loading…</p>
      ) : requests.length > 0 ? (
        <ul className="space-y-2">
          {requests.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-on-surface">{r.signerName}</p>
                  <p className="truncate text-xs text-on-surface-variant">{r.signerEmail}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-1 text-[11px] text-on-surface-variant">
                {r.status === 'signed' && r.signedAt
                  ? `Signed ${fmtTimestamp(r.signedAt)}`
                  : r.createdAt
                    ? `Requested ${fmtTimestamp(r.createdAt)}`
                    : null}
              </p>
              {r.status === 'signed' && r.pdfSnapshotUrl ? (
                <a
                  href={r.pdfSnapshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-pib-accent)] hover:underline"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden>
                    picture_as_pdf
                  </span>
                  Signed PDF copy
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !showForm && canRequest ? (
        <p className="text-xs text-on-surface-variant">No signature requests yet.</p>
      ) : null}
    </section>
  )
}
