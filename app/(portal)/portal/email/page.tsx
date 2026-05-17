'use client'

import { FormEvent, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { MailboxAccountSafe, MailboxFolder, MailboxMessageSafe } from '@/lib/mailbox/types'

export const dynamic = 'force-dynamic'

const FOLDERS: Array<{ id: MailboxFolder; label: string; icon: string }> = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'sent', label: 'Sent', icon: 'send' },
  { id: 'drafts', label: 'Drafts', icon: 'draft' },
  { id: 'archive', label: 'Archive', icon: 'archive' },
  { id: 'trash', label: 'Trash', icon: 'delete' },
]

type AccountForm = {
  provider: 'smtp_imap' | 'google'
  emailAddress: string
  displayName: string
  smtpHost: string
  smtpPort: string
  smtpUser: string
  smtpPassword: string
  imapHost: string
  imapPort: string
  imapUser: string
  imapPassword: string
}

const emptyAccountForm: AccountForm = {
  provider: 'smtp_imap',
  emailAddress: '',
  displayName: '',
  smtpHost: '',
  smtpPort: '465',
  smtpUser: '',
  smtpPassword: '',
  imapHost: '',
  imapPort: '993',
  imapUser: '',
  imapPassword: '',
}

const emptyCompose = {
  accountId: '',
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  bodyText: '',
}

export default function PortalEmailPage() {
  const [accounts, setAccounts] = useState<MailboxAccountSafe[]>([])
  const [messages, setMessages] = useState<MailboxMessageSafe[]>([])
  const [folder, setFolder] = useState<MailboxFolder>('inbox')
  const [accountId, setAccountId] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAccount, setShowAccount] = useState(false)
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm)
  const [compose, setCompose] = useState(emptyCompose)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadAccounts() {
    const res = await fetch('/api/v1/portal/email/accounts')
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? 'Could not load accounts')
    const list = body.data?.accounts ?? []
    setAccounts(list)
    if (!compose.accountId && list[0]?.id) setCompose((prev) => ({ ...prev, accountId: list[0].id }))
  }

  async function loadMessages() {
    setLoading(true)
    const params = new URLSearchParams({ folder, accountId, q })
    const res = await fetch(`/api/v1/portal/email/messages?${params.toString()}`)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? 'Could not load messages')
    const list = body.data?.messages ?? []
    setMessages(list)
    setSelectedId((current) => current && list.some((item: MailboxMessageSafe) => item.id === current) ? current : list[0]?.id ?? null)
    setLoading(false)
  }

  useEffect(() => {
    loadAccounts().catch((err) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadMessages().catch((err) => {
      setError(err.message)
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, accountId, q])

  const selected = useMemo(() => messages.find((item) => item.id === selectedId) ?? null, [messages, selectedId])
  const unread = messages.filter((item) => !item.read).length

  async function saveAccount(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const payload = accountForm.provider === 'google'
      ? {
          provider: 'google',
          emailAddress: accountForm.emailAddress,
          displayName: accountForm.displayName,
          googleOAuth: true,
        }
      : {
          provider: 'smtp_imap',
          emailAddress: accountForm.emailAddress,
          displayName: accountForm.displayName,
          smtp: {
            host: accountForm.smtpHost,
            port: Number(accountForm.smtpPort),
            username: accountForm.smtpUser,
            password: accountForm.smtpPassword,
            secure: true,
          },
          imap: {
            host: accountForm.imapHost,
            port: Number(accountForm.imapPort),
            username: accountForm.imapUser,
            password: accountForm.imapPassword,
            secure: true,
          },
        }
    const res = await fetch('/api/v1/portal/email/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? 'Could not save account')
      return
    }
    setNotice('Email account linked to this workspace profile.')
    setAccountForm(emptyAccountForm)
    setShowAccount(false)
    await loadAccounts()
  }

  async function submitCompose(action: 'send' | 'draft') {
    setError(null)
    const res = await fetch('/api/v1/portal/email/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...compose, action }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? 'Could not save message')
      return
    }
    setNotice(action === 'send' ? 'Message added to sent mail.' : 'Draft saved.')
    setCompose({ ...emptyCompose, accountId: compose.accountId || accounts[0]?.id || '' })
    await loadMessages()
  }

  async function updateMessage(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/v1/portal/email/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await loadMessages()
  }

  async function deleteMessage(id: string) {
    await fetch(`/api/v1/portal/email/messages/${id}`, { method: 'DELETE' })
    await loadMessages()
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Workspace email</p>
          <h1 className="text-2xl md:text-3xl font-semibold">Email</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
            Accounts are linked to your profile inside this workspace, so each client workspace can have its own mailbox set.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-pib-secondary" onClick={() => setShowAccount((v) => !v)}>
            <span className="material-symbols-outlined text-[18px]">add_link</span>
            Link account
          </button>
          <button type="button" className="btn-pib-primary" onClick={() => submitCompose('send')}>
            <span className="material-symbols-outlined text-[18px]">send</span>
            Send
          </button>
        </div>
      </header>

      {(notice || error) && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-red-400/40 text-red-200 bg-red-500/10' : 'border-emerald-400/30 text-emerald-100 bg-emerald-500/10'}`}>
          {error ?? notice}
        </div>
      )}

      {showAccount && (
        <form onSubmit={saveAccount} className="bento-card !p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setAccountForm((f) => ({ ...f, provider: 'smtp_imap' }))} className={accountForm.provider === 'smtp_imap' ? 'btn-pib-primary' : 'btn-pib-secondary'}>
              SMTP + IMAP
            </button>
            <button type="button" onClick={() => setAccountForm((f) => ({ ...f, provider: 'google' }))} className={accountForm.provider === 'google' ? 'btn-pib-primary' : 'btn-pib-secondary'}>
              Google account
            </button>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Email address" value={accountForm.emailAddress} onChange={(v) => setAccountForm((f) => ({ ...f, emailAddress: v }))} type="email" />
            <Field label="Display name" value={accountForm.displayName} onChange={(v) => setAccountForm((f) => ({ ...f, displayName: v }))} />
          </div>
          {accountForm.provider === 'smtp_imap' ? (
            <div className="grid lg:grid-cols-2 gap-4">
              <ServerFields title="SMTP sending" prefix="smtp" form={accountForm} setForm={setAccountForm} />
              <ServerFields title="IMAP receiving" prefix="imap" form={accountForm} setForm={setAccountForm} />
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4 text-sm text-[var(--color-pib-text-muted)]">
              Google mailbox records are stored per profile now. OAuth can be connected to this account record when the Google app credentials are ready.
            </div>
          )}
          <button type="submit" className="btn-pib-primary">Save account</button>
        </form>
      )}

      <div className="grid lg:grid-cols-[220px_minmax(280px,360px)_1fr] gap-4 min-h-[620px]">
        <aside className="bento-card !p-3 space-y-4">
          <div className="space-y-1">
            {FOLDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFolder(item.id)}
                className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left ${folder === item.id ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.04]'}`}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.id === 'inbox' && unread > 0 ? <span className="pill !text-[10px]">{unread}</span> : null}
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--color-pib-line)] pt-4 space-y-2">
            <p className="eyebrow !text-[10px]">Accounts</p>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="pib-input w-full">
              <option value="all">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.emailAddress}</option>
              ))}
            </select>
            {accounts.map((account) => (
              <div key={account.id} className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs">
                <p className="font-medium truncate">{account.displayName}</p>
                <p className="text-[var(--color-pib-text-muted)] truncate">{account.emailAddress}</p>
              </div>
            ))}
          </div>
        </aside>

        <section className="bento-card !p-0 overflow-hidden">
          <div className="p-3 border-b border-[var(--color-pib-line)]">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" className="pib-input w-full" />
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading mail...</div>
            ) : messages.length === 0 ? (
              <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">No messages in this folder yet.</div>
            ) : messages.map((message) => (
              <button
                type="button"
                key={message.id}
                onClick={() => {
                  setSelectedId(message.id)
                  if (!message.read) void updateMessage(message.id, { read: true })
                }}
                className={`w-full text-left px-4 py-3 border-b border-[var(--color-pib-line)] hover:bg-white/[0.03] ${selectedId === message.id ? 'bg-white/[0.05]' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${message.read ? 'bg-transparent' : 'bg-[var(--color-pib-accent)]'}`} />
                  <p className="font-medium truncate flex-1">{folder === 'sent' || folder === 'drafts' ? message.to.join(', ') || 'No recipient' : message.from}</p>
                  <span className="text-[10px] text-[var(--color-pib-text-muted)]">{formatDate(message.createdAt)}</span>
                </div>
                <p className="text-sm truncate mt-1">{message.subject || '(no subject)'}</p>
                <p className="text-xs text-[var(--color-pib-text-muted)] truncate mt-1">{message.snippet}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="bento-card !p-0 overflow-hidden flex flex-col">
          {selected ? (
            <>
              <div className="p-5 border-b border-[var(--color-pib-line)]">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-semibold truncate">{selected.subject || '(no subject)'}</h2>
                    <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
                      {selected.from} to {selected.to.join(', ') || selected.accountEmail}
                    </p>
                  </div>
                  <button type="button" className="w-9 h-9 rounded-lg border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]" title="Star" onClick={() => updateMessage(selected.id, { starred: !selected.starred })}>
                    <span className="material-symbols-outlined text-[18px]">{selected.starred ? 'star' : 'star_outline'}</span>
                  </button>
                  <button type="button" className="w-9 h-9 rounded-lg border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]" title="Archive" onClick={() => updateMessage(selected.id, { folder: 'archive' })}>
                    <span className="material-symbols-outlined text-[18px]">archive</span>
                  </button>
                  <button type="button" className="w-9 h-9 rounded-lg border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]" title="Delete" onClick={() => deleteMessage(selected.id)}>
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
              <div className="p-5 text-sm leading-7 whitespace-pre-wrap flex-1 overflow-y-auto">{selected.bodyText}</div>
            </>
          ) : (
            <div className="p-8 text-sm text-[var(--color-pib-text-muted)]">Select a message to read it.</div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); void submitCompose('send') }} className="border-t border-[var(--color-pib-line)] p-4 space-y-3">
            <div className="grid md:grid-cols-2 gap-2">
              <select value={compose.accountId} onChange={(e) => setCompose((c) => ({ ...c, accountId: e.target.value }))} className="pib-input">
                <option value="">Choose sending account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.emailAddress}</option>)}
              </select>
              <input value={compose.to} onChange={(e) => setCompose((c) => ({ ...c, to: e.target.value }))} placeholder="To" className="pib-input" />
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              <input value={compose.cc} onChange={(e) => setCompose((c) => ({ ...c, cc: e.target.value }))} placeholder="Cc" className="pib-input" />
              <input value={compose.bcc} onChange={(e) => setCompose((c) => ({ ...c, bcc: e.target.value }))} placeholder="Bcc" className="pib-input" />
            </div>
            <input value={compose.subject} onChange={(e) => setCompose((c) => ({ ...c, subject: e.target.value }))} placeholder="Subject" className="pib-input w-full" />
            <textarea value={compose.bodyText} onChange={(e) => setCompose((c) => ({ ...c, bodyText: e.target.value }))} placeholder="Write an email..." rows={5} className="pib-input w-full resize-y" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => submitCompose('draft')} className="btn-pib-secondary">Save draft</button>
              <button type="submit" className="btn-pib-primary">Send</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-[var(--color-pib-text-muted)]">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="pib-input w-full mt-1" />
    </label>
  )
}

function ServerFields({ title, prefix, form, setForm }: { title: string; prefix: 'smtp' | 'imap'; form: AccountForm; setForm: Dispatch<SetStateAction<AccountForm>> }) {
  const key = (name: 'Host' | 'Port' | 'User' | 'Password') => `${prefix}${name}` as keyof AccountForm
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] p-4 space-y-3">
      <p className="font-medium">{title}</p>
      <div className="grid grid-cols-[1fr_100px] gap-2">
        <Field label="Host" value={String(form[key('Host')])} onChange={(v) => setForm((f) => ({ ...f, [key('Host')]: v }))} />
        <Field label="Port" value={String(form[key('Port')])} onChange={(v) => setForm((f) => ({ ...f, [key('Port')]: v }))} />
      </div>
      <Field label="Username" value={String(form[key('User')])} onChange={(v) => setForm((f) => ({ ...f, [key('User')]: v }))} />
      <Field label="Password" value={String(form[key('Password')])} onChange={(v) => setForm((f) => ({ ...f, [key('Password')]: v }))} type="password" />
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-ZA', { month: 'short', day: 'numeric' }).format(new Date(value))
}
