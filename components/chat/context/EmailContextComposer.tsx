'use client'

import { Icon } from '@/components/studio'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MailboxAccountSafe, MailboxMessageSafe } from '@/lib/mailbox/types'

type MailboxSurface = 'admin' | 'portal'

type ComposerState = {
  accountId: string
  to: string
  cc: string
  bcc: string
  subject: string
  bodyText: string
  includeSignature: boolean
}

const ENDPOINTS: Record<MailboxSurface, { accounts: string; messages: string }> = {
  admin: {
    accounts: '/api/v1/admin/mailbox/accounts',
    messages: '/api/v1/admin/mailbox/messages',
  },
  portal: {
    accounts: '/api/v1/portal/email/accounts',
    messages: '/api/v1/portal/email/messages',
  },
}

function detectSurface(): MailboxSurface {
  if (typeof window === 'undefined') return 'portal'
  return window.location.pathname.startsWith('/admin') ? 'admin' : 'portal'
}

function joinEmails(values: string[] | undefined): string {
  return (values ?? []).filter(Boolean).join(', ')
}

function composerFromMessage(message: MailboxMessageSafe, includeSignature = true): ComposerState {
  return {
    accountId: message.accountId,
    to: joinEmails(message.to),
    cc: joinEmails(message.cc),
    bcc: joinEmails(message.bcc),
    subject: message.subject ?? '',
    bodyText: message.bodyText || message.snippet || '',
    includeSignature,
  }
}

export function EmailContextComposer({
  messageId,
  refreshRevision = 0,
}: {
  messageId: string
  refreshRevision?: number
}) {
  const surface = useMemo(() => detectSurface(), [])
  const endpoints = ENDPOINTS[surface]
  const [accounts, setAccounts] = useState<MailboxAccountSafe[]>([])
  const [message, setMessage] = useState<MailboxMessageSafe | null>(null)
  const [compose, setCompose] = useState<ComposerState | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState<'save' | 'send' | null>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const [error, setError] = useState<string | null>(null)
  const [sentMessageId, setSentMessageId] = useState<string | null>(null)
  const loadedMessageIdRef = useRef<string | null>(null)

  useEffect(() => {
    loadedMessageIdRef.current = null
  }, [messageId])

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    const initial = loadedMessageIdRef.current !== messageId
    if (initial) {
      setState('loading')
      setSentMessageId(null)
    }
    Promise.all([
      fetch(endpoints.accounts, { signal: controller.signal }),
      fetch(`${endpoints.messages}/${encodeURIComponent(messageId)}`, { signal: controller.signal }),
    ]).then(async ([accountsResponse, messageResponse]) => {
      if (!accountsResponse.ok || !messageResponse.ok) throw new Error('Email draft unavailable')
      const accountsBody = await accountsResponse.json()
      const messageBody = await messageResponse.json()
      const nextAccounts = (accountsBody.data?.accounts ?? accountsBody.accounts ?? []) as MailboxAccountSafe[]
      const nextMessage = (messageBody.data?.message ?? messageBody.message) as MailboxMessageSafe
      if (!nextMessage?.id) throw new Error('Email draft unavailable')
      setAccounts(nextAccounts)
      setMessage(nextMessage)
      // Prefer live server draft so agent edits appear; skip clobber while user is saving/sending.
      if (!busyRef.current) {
        setCompose((current) => composerFromMessage(nextMessage, current?.includeSignature ?? true))
      }
      setState('ready')
      loadedMessageIdRef.current = messageId
    }).catch((cause) => {
      if (controller.signal.aborted) return
      void cause
      if (initial) setState('error')
    })
    return () => controller.abort()
  }, [endpoints.accounts, endpoints.messages, messageId, refreshRevision])

  const connectedAccounts = accounts.filter((account) => account.status === 'connected')
  const reconnectableAccounts = accounts.filter(
    (account) => account.provider === 'google' && account.status !== 'connected',
  )
  const selectedAccount = connectedAccounts.find((account) => account.id === compose?.accountId)
    ?? connectedAccounts.find((account) => account.isDefault)
    ?? connectedAccounts[0]
    ?? null
  const primaryReconnectAccount = reconnectableAccounts.find((account) => account.id === compose?.accountId)
    ?? reconnectableAccounts.find((account) => account.emailAddress === message?.accountEmail)
    ?? reconnectableAccounts[0]
    ?? null
  const isDraft = message?.status === 'draft' || message?.folder === 'drafts'
  const canSend = Boolean(isDraft && selectedAccount && compose?.to.trim() && (compose.subject.trim() || compose.bodyText.trim()))

  function googleAuthorizeHref(account: { emailAddress: string; displayName?: string }): string {
    const base = surface === 'admin'
      ? '/api/v1/admin/mailbox/google/authorize'
      : '/api/v1/portal/email/google/authorize'
    const params = new URLSearchParams()
    if (account.emailAddress.trim()) params.set('emailAddress', account.emailAddress.trim())
    if (account.displayName?.trim()) params.set('displayName', account.displayName.trim())
    const query = params.toString()
    return query ? `${base}?${query}` : base
  }

  async function saveDraft() {
    if (!compose || !message || !isDraft) return
    setBusy('save')
    setError(null)
    try {
      const response = await fetch(`${endpoints.messages}/${encodeURIComponent(message.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: compose.accountId || selectedAccount?.id,
          to: compose.to,
          cc: compose.cc,
          bcc: compose.bcc,
          subject: compose.subject,
          bodyText: compose.bodyText,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Could not save draft')
      const nextMessage = (body?.data?.message ?? body?.message) as MailboxMessageSafe
      setMessage(nextMessage)
      setCompose(composerFromMessage(nextMessage, compose.includeSignature !== false))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save draft')
    } finally {
      setBusy(null)
    }
  }

  async function approveAndSend() {
    if (!compose || !message || !selectedAccount || !canSend) return
    if (!window.confirm('Send this email from your connected mailbox?')) return
    setBusy('send')
    setError(null)
    try {
      const patchResponse = await fetch(`${endpoints.messages}/${encodeURIComponent(message.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: compose.to,
          cc: compose.cc,
          bcc: compose.bcc,
          subject: compose.subject,
          bodyText: compose.bodyText,
        }),
      })
      if (!patchResponse.ok) {
        const body = await patchResponse.json().catch(() => null)
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not save draft before send')
      }

      const sendResponse = await fetch(endpoints.messages, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount.id,
          to: compose.to,
          cc: compose.cc,
          bcc: compose.bcc,
          subject: compose.subject,
          bodyText: compose.bodyText,
          sendApproved: true,
          includeSignature: compose.includeSignature !== false,
        }),
      })
      const sendBody = await sendResponse.json().catch(() => null)
      if (!sendResponse.ok) throw new Error(typeof sendBody?.error === 'string' ? sendBody.error : 'Send failed')

      await fetch(`${endpoints.messages}/${encodeURIComponent(message.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'trash' }),
      }).catch(() => undefined)

      const sent = (sendBody?.data?.message ?? sendBody?.message) as MailboxMessageSafe | undefined
      setSentMessageId(sent?.id ?? 'sent')
      if (sent) {
        setMessage(sent)
        setCompose(composerFromMessage(sent))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Send failed')
    } finally {
      setBusy(null)
    }
  }

  if (state === 'loading') {
    return (
      <div className="grid min-h-48 place-items-center rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] text-xs text-[var(--color-pib-text-muted)]">
        <span className="inline-flex items-center gap-2">
          <Icon name="progress_activity" className="animate-spin text-[18px]" />
          Loading email draft…
        </span>
      </div>
    )
  }

  if (state === 'error' || !message || !compose) {
    return (
      <div role="status" className="rounded-[6px] border border-amber-400/20 bg-[var(--sc-surface)]/5 px-3 py-4 text-xs text-[var(--sc-ink-soft)]">
        The email draft is unavailable. Open the full mailbox workspace to continue.
      </div>
    )
  }

  if (sentMessageId || (!isDraft && message.status === 'sent')) {
    return (
      <div data-testid="context-email-composer" className="space-y-3 rounded-[6px] border border-emerald-400/20 bg-emerald-500/5 p-4">
        <p className="text-[10px] font-label uppercase tracking-[0.18em] text-emerald-200">Sent</p>
        <h3 className="text-sm text-[var(--color-pib-text)]">{message.subject || '(no subject)'}</h3>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          From {message.accountEmail || message.from || selectedAccount?.emailAddress || 'connected mailbox'}
          {message.to?.length ? ` → ${joinEmails(message.to)}` : ''}
        </p>
        {message.bodyText ? (
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-pib-text)]">{message.bodyText}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div data-testid="context-email-composer" className="space-y-3 rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Email draft</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            {selectedAccount
              ? `Sending as ${selectedAccount.emailAddress}`
              : reconnectableAccounts.length > 0
                ? 'Mailbox needs reconnection - Google access expired or was revoked.'
                : connectedAccounts.length === 0
                  ? 'No connected mailbox - connect Google or SMTP before sending.'
                  : 'Choose a connected mailbox account.'}
          </p>
        </div>
        <a
          href={surface === 'admin' ? '/admin/email/mailbox' : '/portal/email'}
          className="inline-flex min-h-11 items-center text-xs text-primary xl:min-h-8"
        >
          Open mailbox
        </a>
      </div>

      {!isDraft ? (
        <div role="status" className="rounded-lg border border-amber-400/20 bg-[var(--sc-surface)]/5 px-3 py-2 text-xs text-[var(--sc-ink-soft)]">
          This message is no longer a draft, so it opens read-only here.
        </div>
      ) : null}

      {error ? <div role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div> : null}

      {isDraft && !selectedAccount && primaryReconnectAccount ? (
        <div
          role="status"
          data-testid="mailbox-reconnect-banner"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/25 bg-[var(--sc-surface)]/10 px-3 py-2"
        >
          <p className="min-w-0 text-xs text-[var(--sc-ink-soft)]">
            <span className="font-medium">{primaryReconnectAccount.emailAddress}</span>
            {' '}needs Google reconnection before you can send.
          </p>
          <a
            href={googleAuthorizeHref(primaryReconnectAccount)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-amber-300/30 bg-[var(--sc-surface)]/15 px-3 text-xs text-[var(--sc-ink-soft)] hover:bg-[var(--sc-surface)]/25 xl:min-h-8"
          >
            Reconnect Google
          </a>
        </div>
      ) : null}

      <label className="block space-y-1">
        <span className="text-[10px] font-label uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">From</span>
        <select
          aria-label="Sending account"
          disabled={!isDraft || (connectedAccounts.length === 0 && reconnectableAccounts.length === 0) || busy !== null}
          value={compose.accountId || selectedAccount?.id || primaryReconnectAccount?.id || ''}
          onChange={(event) => setCompose((current) => current ? { ...current, accountId: event.target.value } : current)}
          className="h-11 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2 text-xs text-[var(--color-pib-text)] xl:h-9"
        >
          {connectedAccounts.length === 0 && reconnectableAccounts.length === 0 ? (
            <option value="">No connected account</option>
          ) : null}
          {connectedAccounts.map((account) => (
            <option key={account.id} value={account.id}>{account.emailAddress}{account.isDefault ? ' (default)' : ''}</option>
          ))}
          {reconnectableAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.emailAddress} (reconnect required)
            </option>
          ))}
        </select>
        {isDraft && reconnectableAccounts.length > 0 && !selectedAccount ? (
          <p className="text-[10px] text-[var(--color-pib-text-muted)]">
            Selected account is listed but cannot send until Google is reconnected.
          </p>
        ) : null}
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] font-label uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">To</span>
        <input
          aria-label="To"
          disabled={!isDraft || busy !== null}
          value={compose.to}
          onChange={(event) => setCompose((current) => current ? { ...current, to: event.target.value } : current)}
          className="h-11 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2 text-xs text-[var(--color-pib-text)] xl:h-9"
          placeholder="recipient@example.com"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[10px] font-label uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">Cc</span>
          <input
            aria-label="Cc"
            disabled={!isDraft || busy !== null}
            value={compose.cc}
            onChange={(event) => setCompose((current) => current ? { ...current, cc: event.target.value } : current)}
            className="h-11 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2 text-xs text-[var(--color-pib-text)] xl:h-9"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-label uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">Bcc</span>
          <input
            aria-label="Bcc"
            disabled={!isDraft || busy !== null}
            value={compose.bcc}
            onChange={(event) => setCompose((current) => current ? { ...current, bcc: event.target.value } : current)}
            className="h-11 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2 text-xs text-[var(--color-pib-text)] xl:h-9"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] font-label uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">Subject</span>
        <input
          aria-label="Subject"
          disabled={!isDraft || busy !== null}
          value={compose.subject}
          onChange={(event) => setCompose((current) => current ? { ...current, subject: event.target.value } : current)}
          className="h-11 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-2 text-xs text-[var(--color-pib-text)] xl:h-9"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] font-label uppercase tracking-[0.15em] text-[var(--color-pib-text-muted)]">Body</span>
        <textarea
          aria-label="Body"
          disabled={!isDraft || busy !== null}
          value={compose.bodyText}
          onChange={(event) => setCompose((current) => current ? { ...current, bodyText: event.target.value } : current)}
          rows={12}
          className="min-h-48 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 py-2 text-xs leading-relaxed text-[var(--color-pib-text)]"
        />
      </label>

      {isDraft && selectedAccount?.provider === 'google' ? (
        <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] px-3 py-2 xl:min-h-0">
          <input
            type="checkbox"
            data-testid="include-gmail-signature"
            aria-label="Include Gmail signature"
            disabled={busy !== null}
            checked={compose.includeSignature !== false}
            onChange={(event) => setCompose((current) => current
              ? { ...current, includeSignature: event.target.checked }
              : current)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--color-card-border)] accent-primary"
          />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-[var(--color-pib-text)]">Include Gmail signature</span>
            <span className="mt-0.5 block text-[10px] leading-snug text-[var(--color-pib-text-muted)]">
              Appends your Gmail send-as signature on send (not shown in the draft body). Requires a recent Google reconnect for settings access.
            </span>
          </span>
        </label>
      ) : null}

      {isDraft ? (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => { void saveDraft() }}
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text)] disabled:opacity-50 xl:min-h-8"
          >
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            disabled={!canSend || busy !== null}
            onClick={() => { void approveAndSend() }}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-primary/30 bg-primary/15 px-3 text-xs text-primary disabled:opacity-50 xl:min-h-8"
          >
            <Icon name="send" className="text-[15px]" />
            {busy === 'send' ? 'Sending…' : 'Approve & send'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
