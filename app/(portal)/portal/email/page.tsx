'use client'

import { FormEvent, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'next/navigation'
import type { MailboxAccountSafe, MailboxFolder, MailboxMessageSafe } from '@/lib/mailbox/types'

export const dynamic = 'force-dynamic'

const FOLDERS: Array<{ id: MailboxFolder; label: string; icon: string }> = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'sent', label: 'Sent', icon: 'send' },
  { id: 'drafts', label: 'Drafts', icon: 'draft' },
  { id: 'archive', label: 'Archive', icon: 'archive' },
  { id: 'trash', label: 'Trash', icon: 'delete' },
]

const EMAIL_TEMPLATES = [
  {
    id: 'quick-reply',
    label: 'Quick reply',
    subject: 'Re: ',
    bodyHtml: '<p>Hi,</p><p>Thanks for the note. I will take a look and come back to you shortly.</p><p>Regards,</p>',
  },
  {
    id: 'meeting-recap',
    label: 'Meeting recap',
    subject: 'Recap and next steps',
    bodyHtml: '<p>Hi,</p><p>Thanks for the time today. Here is the short recap:</p><ul><li>Decision:</li><li>Next step:</li><li>Owner:</li></ul><p>Regards,</p>',
  },
  {
    id: 'proposal-follow-up',
    label: 'Proposal follow-up',
    subject: 'Following up on the proposal',
    bodyHtml: '<p>Hi,</p><p>I wanted to follow up on the proposal and check whether there are any questions I can clear up.</p><p>If the scope still looks right, I can prepare the next step from our side.</p><p>Regards,</p>',
  },
  {
    id: 'welcome',
    label: 'Welcome',
    subject: 'Welcome',
    bodyHtml: '<p>Hi,</p><p>Welcome. We are glad to have you here.</p><p>I will keep this thread clear and useful so the next steps are easy to follow.</p><p>Regards,</p>',
  },
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

type ComposeState = {
  accountId: string
  to: string
  cc: string
  bcc: string
  subject: string
  bodyText: string
  bodyHtml: string
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

const emptyCompose: ComposeState = {
  accountId: '',
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  bodyText: '',
  bodyHtml: '',
}

function htmlToText(html: string): string {
  if (!html) return ''
  if (typeof window === 'undefined') return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const div = window.document.createElement('div')
  div.innerHTML = html
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export default function PortalEmailPage() {
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<MailboxAccountSafe[]>([])
  const [messages, setMessages] = useState<MailboxMessageSafe[]>([])
  const [folder, setFolder] = useState<MailboxFolder>('inbox')
  const [accountId, setAccountId] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAccount, setShowAccount] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm)
  const [compose, setCompose] = useState<ComposeState>(emptyCompose)
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
    const status = searchParams.get('emailStatus')
    const message = searchParams.get('message')
    if (status === 'connected') setNotice('Google mailbox connected.')
    if (status === 'error') setError(message ? `Google mailbox connection failed: ${message}` : 'Google mailbox connection failed.')
  }, [searchParams])

  useEffect(() => {
    loadMessages().catch((err) => {
      setError(err.message)
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, accountId, q])

  const selected = useMemo(() => messages.find((item) => item.id === selectedId) ?? null, [messages, selectedId])
  const unread = messages.filter((item) => !item.read).length
  const defaultAccountId = compose.accountId || accounts.find((account) => account.isDefault)?.id || accounts[0]?.id || ''

  function startCompose(prefill?: Partial<ComposeState>) {
    setError(null)
    setNotice(null)
    setCompose({
      ...emptyCompose,
      accountId: defaultAccountId,
      ...prefill,
    })
    setShowComposer(true)
  }

  function editDraft(message: MailboxMessageSafe) {
    startCompose({
      accountId: message.accountId,
      to: message.to.join(', '),
      cc: message.cc.join(', '),
      bcc: message.bcc.join(', '),
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml ?? message.bodyText.replace(/\n/g, '<br>'),
    })
  }

  function applyTemplate(templateId: string) {
    const template = EMAIL_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    setCompose((prev) => ({
      ...prev,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: htmlToText(template.bodyHtml),
    }))
    setShowComposer(true)
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (accountForm.provider === 'google') {
      const params = new URLSearchParams()
      if (accountForm.emailAddress.trim()) params.set('emailAddress', accountForm.emailAddress.trim())
      if (accountForm.displayName.trim()) params.set('displayName', accountForm.displayName.trim())
      window.location.href = `/api/v1/portal/email/google/authorize?${params.toString()}`
      return
    }
    const payload = {
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
    setNotice('Email account linked.')
    setAccountForm(emptyAccountForm)
    setShowAccount(false)
    await loadAccounts()
  }

  async function submitCompose(action: 'send' | 'draft') {
    setError(null)
    const res = await fetch('/api/v1/portal/email/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...compose,
        accountId: compose.accountId || defaultAccountId,
        bodyText: compose.bodyText || htmlToText(compose.bodyHtml),
        action,
        sendApproved: action === 'send',
      }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? 'Could not save message')
      return
    }
    setNotice(action === 'send' ? 'Message added to sent mail.' : 'Draft saved.')
    setCompose({ ...emptyCompose, accountId: defaultAccountId })
    setShowComposer(false)
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
    <div className="flex min-h-[calc(100dvh-5.5rem)] flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Workspace email</p>
          <h1 className="text-2xl font-semibold">Email</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-pib-secondary" onClick={() => setShowAccount((v) => !v)}>
            <span className="material-symbols-outlined text-[18px]">add_link</span>
            Link account
          </button>
          <button type="button" className="btn-pib-primary" onClick={() => startCompose()}>
            <span className="material-symbols-outlined text-[18px]">edit_square</span>
            New email
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
              Continue with Google to approve mailbox access. PiB stores the OAuth token on this workspace profile after Google returns you here.
            </div>
          )}
          <button type="submit" className="btn-pib-primary">
            {accountForm.provider === 'google' ? 'Continue with Google' : 'Save account'}
          </button>
        </form>
      )}

      <div className="grid flex-1 gap-3 lg:grid-cols-[210px_minmax(320px,430px)_minmax(0,1fr)]">
        <aside className="bento-card !p-3 space-y-4 overflow-hidden">
          <div className="space-y-1">
            {FOLDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setFolder(item.id)
                  setShowComposer(false)
                }}
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
            <div className="space-y-2">
              {accounts.map((account) => (
                <div key={account.id} className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate font-medium">{account.displayName}</p>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${account.status === 'connected' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-amber-500/10 text-amber-200'}`}>
                      {account.provider === 'google' ? 'Google' : 'IMAP'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[var(--color-pib-text-muted)]">{account.emailAddress}</p>
                  {account.status !== 'connected' ? (
                    <p className="mt-1 text-[var(--color-pib-text-muted)]">Needs connection</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="bento-card !p-0 overflow-hidden">
          <div className="p-3 border-b border-[var(--color-pib-line)]">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" className="pib-input w-full" />
          </div>
          <div className="h-[calc(100dvh-12rem)] min-h-[560px] overflow-y-auto">
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
                  setShowComposer(false)
                  if (!message.read) void updateMessage(message.id, { read: true })
                }}
                className={`w-full text-left px-4 py-3 border-b border-[var(--color-pib-line)] hover:bg-white/[0.03] ${selectedId === message.id && !showComposer ? 'bg-white/[0.05]' : ''}`}
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

        <section className="bento-card !p-0 overflow-hidden flex min-h-[560px] flex-col">
          {showComposer ? (
            <ComposerPanel
              accounts={accounts}
              compose={compose}
              setCompose={setCompose}
              onClose={() => setShowComposer(false)}
              onSend={() => submitCompose('send')}
              onDraft={() => submitCompose('draft')}
              onTemplate={applyTemplate}
            />
          ) : selected ? (
            <MessagePane
              message={selected}
              onStar={() => updateMessage(selected.id, { starred: !selected.starred })}
              onArchive={() => updateMessage(selected.id, { folder: 'archive' })}
              onDelete={() => deleteMessage(selected.id)}
              onEditDraft={() => editDraft(selected)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--color-pib-text-muted)]">Select a message to read it.</div>
          )}
        </section>
      </div>
    </div>
  )
}

function MessagePane({
  message,
  onStar,
  onArchive,
  onDelete,
  onEditDraft,
}: {
  message: MailboxMessageSafe
  onStar: () => void
  onArchive: () => void
  onDelete: () => void
  onEditDraft: () => void
}) {
  const isDraft = message.status === 'draft' || message.folder === 'drafts'
  return (
    <>
      <div className="p-5 border-b border-[var(--color-pib-line)]">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold truncate">{message.subject || '(no subject)'}</h2>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
              {message.from} to {message.to.join(', ') || message.accountEmail}
            </p>
          </div>
          {isDraft && (
            <button type="button" className="btn-pib-secondary !py-2" onClick={onEditDraft}>
              <span className="material-symbols-outlined text-[18px]">edit_square</span>
              Edit
            </button>
          )}
          <IconButton title="Star" icon={message.starred ? 'star' : 'star_outline'} onClick={onStar} />
          <IconButton title="Archive" icon="archive" onClick={onArchive} />
          <IconButton title="Delete" icon="delete" onClick={onDelete} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 text-sm leading-7 whitespace-pre-wrap">{message.bodyText}</div>
    </>
  )
}

function ComposerPanel({
  accounts,
  compose,
  setCompose,
  onClose,
  onSend,
  onDraft,
  onTemplate,
}: {
  accounts: MailboxAccountSafe[]
  compose: ComposeState
  setCompose: Dispatch<SetStateAction<ComposeState>>
  onClose: () => void
  onSend: () => void
  onDraft: () => void
  onTemplate: (templateId: string) => void
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSend() }} className="flex h-full min-h-[560px] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-pib-line)] px-5 py-4">
        <div>
          <p className="eyebrow !text-[10px]">Compose</p>
          <h2 className="text-lg font-semibold">New email</h2>
        </div>
        <button type="button" className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]" onClick={onClose} title="Close compose">
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div className="grid flex-1 overflow-hidden xl:grid-cols-[1fr_210px]">
        <div className="flex min-w-0 flex-col overflow-y-auto p-5">
          <div className="grid gap-2 md:grid-cols-[minmax(180px,260px)_1fr]">
            <select value={compose.accountId} onChange={(e) => setCompose((c) => ({ ...c, accountId: e.target.value }))} className="pib-input">
              <option value="">Choose sending account</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.emailAddress}</option>)}
            </select>
            <input value={compose.to} onChange={(e) => setCompose((c) => ({ ...c, to: e.target.value }))} placeholder="To" className="pib-input" />
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <input value={compose.cc} onChange={(e) => setCompose((c) => ({ ...c, cc: e.target.value }))} placeholder="Cc" className="pib-input" />
            <input value={compose.bcc} onChange={(e) => setCompose((c) => ({ ...c, bcc: e.target.value }))} placeholder="Bcc" className="pib-input" />
          </div>
          <input value={compose.subject} onChange={(e) => setCompose((c) => ({ ...c, subject: e.target.value }))} placeholder="Subject" className="pib-input mt-2 w-full" />
          <RichComposer
            value={compose.bodyHtml}
            onChange={(bodyHtml) => setCompose((c) => ({ ...c, bodyHtml, bodyText: htmlToText(bodyHtml) }))}
          />
        </div>

        <aside className="border-t border-[var(--color-pib-line)] p-4 xl:border-l xl:border-t-0">
          <p className="eyebrow !text-[10px] mb-3">Templates</p>
          <div className="space-y-2">
            {EMAIL_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onTemplate(template.id)}
                className="w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-left text-sm hover:border-[var(--color-pib-accent)]/50 hover:bg-white/[0.04]"
              >
                {template.label}
              </button>
            ))}
          </div>
        </aside>
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--color-pib-line)] px-5 py-4">
        <button type="button" onClick={onDraft} className="btn-pib-secondary">Save draft</button>
        <button type="submit" className="btn-pib-primary">
          <span className="material-symbols-outlined text-[18px]">send</span>
          Send
        </button>
      </div>
    </form>
  )
}

function RichComposer({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [showLinkPanel, setShowLinkPanel] = useState(false)
  const [linkUrl, setLinkUrl] = useState('https://')

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value
    }
  }, [value])

  function sync() {
    onChange(editorRef.current?.innerHTML ?? '')
  }

  function exec(command: string, commandValue?: string) {
    document.execCommand(command, false, commandValue)
    editorRef.current?.focus()
    sync()
  }

  function openLinkPanel() {
    setLinkUrl('https://')
    setShowLinkPanel(true)
  }

  function applyLink() {
    const trimmed = linkUrl.trim()
    if (!trimmed || trimmed === 'https://') return
    exec('createLink', trimmed)
    setShowLinkPanel(false)
  }

  const buttonClass = 'h-8 min-w-8 rounded-md px-2 text-sm text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]'

  return (
    <div className="mt-3 flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-pib-line)] px-2 py-2">
        <button type="button" className={`${buttonClass} font-bold`} onMouseDown={(e) => { e.preventDefault(); exec('bold') }} title="Bold">B</button>
        <button type="button" className={`${buttonClass} italic`} onMouseDown={(e) => { e.preventDefault(); exec('italic') }} title="Italic">I</button>
        <button type="button" className={`${buttonClass} underline`} onMouseDown={(e) => { e.preventDefault(); exec('underline') }} title="Underline">U</button>
        <span className="mx-1 h-5 w-px bg-[var(--color-pib-line)]" />
        <button type="button" className={buttonClass} onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList') }} title="Bulleted list">
          <span className="material-symbols-outlined text-[18px]">format_list_bulleted</span>
        </button>
        <button type="button" className={buttonClass} onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList') }} title="Numbered list">
          <span className="material-symbols-outlined text-[18px]">format_list_numbered</span>
        </button>
        <button type="button" className={buttonClass} onMouseDown={(e) => { e.preventDefault(); openLinkPanel() }} title="Insert link" aria-label="Insert link">
          <span className="material-symbols-outlined text-[18px]">link</span>
        </button>
      </div>
      {showLinkPanel && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="email-link-panel-title"
          className="border-b border-[var(--color-pib-line)] bg-white/[0.035] px-3 py-3"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="min-w-0 flex-1">
              <p id="email-link-panel-title" className="eyebrow !text-[10px]">Insert email link</p>
              <label htmlFor="email-link-url" className="mt-2 block text-xs font-medium text-[var(--color-pib-text-muted)]">
                URL to link
              </label>
              <input
                id="email-link-url"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                className="pib-input mt-1 w-full"
                inputMode="url"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-pib-secondary text-xs"
                onClick={() => setShowLinkPanel(false)}
                aria-label="Cancel email link insert"
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-pib-primary text-xs"
                onClick={applyLink}
                disabled={!linkUrl.trim() || linkUrl.trim() === 'https://'}
                aria-label="Apply link to email body"
              >
                Apply link
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        className="min-h-[320px] flex-1 overflow-y-auto px-4 py-3 text-sm leading-7 outline-none"
        style={{ wordBreak: 'break-word' }}
      />
    </div>
  )
}

function IconButton({ title, icon, onClick }: { title: string; icon: string; onClick: () => void }) {
  return (
    <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.04] hover:text-[var(--color-pib-text)]" title={title} onClick={onClick}>
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
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
