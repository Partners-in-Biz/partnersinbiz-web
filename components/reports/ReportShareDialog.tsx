'use client'

import { useEffect, useState } from 'react'
import type { ReportsWorkspaceReport } from './ReportsWorkspace'

interface ShareState {
  enabled: boolean
  expiresAt: string | null
  subject?: string
  message?: string
}

interface Props {
  report: ReportsWorkspaceReport
  orgId: string | null
  onClose: () => void
  onMutated?: () => void
}

export function ReportShareDialog({ report, orgId, onClose, onMutated }: Props) {
  const [share, setShare] = useState<ShareState>({ enabled: true, expiresAt: null })
  const [publicToken, setPublicToken] = useState<string | null>(report.publicToken)
  const [openCount, setOpenCount] = useState(0)
  const [uniqueOpens, setUniqueOpens] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  // Email share form
  const [emailTo, setEmailTo] = useState('')
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState<string | null>(null)

  function api(path: string) {
    return orgId ? `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(orgId)}` : path
  }

  const shareUrl = publicToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/reports/${publicToken}` : ''

  useEffect(() => {
    fetch(api(`/api/v1/reports/${report.id}/share`))
      .then((r) => r.json())
      .then((b) => {
        if (b.share) setShare(b.share)
        if (typeof b.publicToken !== 'undefined') setPublicToken(b.publicToken)
        setOpenCount(b.openCount ?? 0)
        setUniqueOpens(b.uniqueOpenCount ?? 0)
        setSubjectFromShare(b.share)
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id])

  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  function setSubjectFromShare(s?: ShareState) {
    if (s?.subject) setSubject(s.subject)
    if (s?.message) setMessage(s.message)
  }

  async function saveSettings(patch: Partial<ShareState>) {
    setSaving(true)
    try {
      const res = await fetch(api(`/api/v1/reports/${report.id}/share`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const b = await res.json()
      if (b.share) setShare(b.share)
      if (typeof b.publicToken !== 'undefined') setPublicToken(b.publicToken)
      onMutated?.()
    } finally {
      setSaving(false)
    }
  }

  async function tokenAction(action: 'disable' | 'regenerate') {
    setSaving(true)
    try {
      const res = await fetch(api(`/api/v1/reports/${report.id}/share`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const b = await res.json()
      setPublicToken(b.publicToken ?? null)
      if (action === 'disable') setShare((s) => ({ ...s, enabled: false }))
      else setShare((s) => ({ ...s, enabled: true }))
      onMutated?.()
    } finally {
      setSaving(false)
    }
  }

  async function copyUrl() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function sendEmail() {
    const recipients = emailTo.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean)
    if (recipients.length === 0) {
      setSendMsg('Add at least one recipient.')
      return
    }
    setSending(true)
    setSendMsg(null)
    try {
      const res = await fetch(api(`/api/v1/reports/${report.id}/share-email`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: recipients, subject: subject || undefined, message: message || undefined }),
      })
      const b = await res.json()
      if (!res.ok) {
        setSendMsg(b.error ?? 'Send failed.')
      } else {
        setSendMsg(`Sent to ${recipients.length} recipient${recipients.length > 1 ? 's' : ''}.`)
        setEmailTo('')
        onMutated?.()
      }
    } catch {
      setSendMsg('Send failed.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="bento-card !p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="font-display text-xl">Share report</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {loading ? (
          <div className="pib-skeleton h-40" />
        ) : (
          <>
            {/* Open stats */}
            <div className="flex gap-3 text-xs font-mono text-[var(--color-pib-text-muted)]">
              <span>{uniqueOpens} unique opens</span>
              <span>·</span>
              <span>{openCount} total opens</span>
            </div>

            {/* Public toggle */}
            <label className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm">Public link enabled</span>
              <input
                type="checkbox"
                checked={share.enabled && Boolean(publicToken)}
                disabled={saving || !publicToken}
                onChange={(e) => saveSettings({ enabled: e.target.checked })}
                className="h-4 w-4 accent-[var(--color-pib-accent)]"
              />
            </label>

            {/* URL + copy */}
            {publicToken ? (
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="pib-input flex-1 !text-xs font-mono"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" onClick={copyUrl} className="btn-pib-secondary !py-2 !px-3 !text-sm">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-rose-300">The public link is disabled. Re-enable to share.</p>
            )}

            {/* Expiry */}
            <div>
              <label className="block text-xs uppercase tracking-wider text-[var(--color-pib-text-muted)] mb-1">
                Link expiry date
              </label>
              <input
                type="date"
                value={share.expiresAt ?? ''}
                disabled={saving}
                onChange={(e) => saveSettings({ expiresAt: e.target.value || null })}
                className="pib-input !text-sm"
              />
              {share.expiresAt && (
                <button
                  type="button"
                  onClick={() => saveSettings({ expiresAt: null })}
                  className="text-xs text-[var(--color-pib-text-muted)] underline mt-1"
                >
                  Clear expiry
                </button>
              )}
            </div>

            {/* Token controls */}
            <div className="flex gap-2 pt-1">
              {publicToken ? (
                <button
                  type="button"
                  onClick={() => tokenAction('disable')}
                  disabled={saving}
                  className="btn-pib-secondary !py-2 !px-3 !text-sm !text-rose-300 !border-rose-400/40"
                >
                  Disable link
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => tokenAction('regenerate')}
                disabled={saving}
                className="btn-pib-secondary !py-2 !px-3 !text-sm"
                title="Generate a fresh token (old URL stops working)"
              >
                {publicToken ? 'Regenerate link' : 'Create new link'}
              </button>
            </div>

            <hr className="border-white/10" />

            {/* Email share */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Share by email</h3>
              <input
                type="text"
                placeholder="emails, comma-separated"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                className="pib-input !text-sm w-full"
              />
              <input
                type="text"
                placeholder="Subject (optional)"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="pib-input !text-sm w-full"
              />
              <textarea
                placeholder="Personal message (optional)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="pib-input !text-sm w-full"
              />
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={sendEmail}
                  disabled={sending || !publicToken}
                  className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-60"
                >
                  {sending ? 'Sending...' : 'Send'}
                </button>
                {sendMsg && <span className="text-xs text-[var(--color-pib-text-muted)]">{sendMsg}</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
