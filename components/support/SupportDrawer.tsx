'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupportCategory, SupportMessage, SupportPriority, SupportTicket } from '@/lib/support/types'

const CATEGORY_OPTIONS: Array<{ value: SupportCategory; label: string; icon: string }> = [
  { value: 'question', label: 'Question', icon: 'help' },
  { value: 'bug', label: 'Bug', icon: 'bug_report' },
  { value: 'content_change', label: 'Content change', icon: 'edit_note' },
  { value: 'billing', label: 'Billing', icon: 'payments' },
  { value: 'urgent', label: 'Urgent', icon: 'priority_high' },
]

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  waiting_on_us: 'Waiting on us',
  waiting_on_client: 'Waiting on you',
  resolved: 'Resolved',
}

function ticketTime(ticket: SupportTicket) {
  const value = ticket.lastMessageAt ?? ticket.updatedAt ?? ticket.createdAt
  if (!value || typeof value !== 'string') return ''
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function SupportDrawer({ triggerClassName = '' }: { triggerClassName?: string }) {
  const [open, setOpen] = useState(false)
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [category, setCategory] = useState<SupportCategory>('question')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [reply, setReply] = useState('')

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [tickets, selectedId],
  )

  async function refreshTickets(nextSelectedId?: string) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/portal/support')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Could not load support tickets')
      const nextTickets = body.data ?? []
      setTickets(nextTickets)
      if (nextSelectedId) setSelectedId(nextSelectedId)
      else if (!selectedId && nextTickets[0]?.id) setSelectedId(nextTickets[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load support tickets')
    } finally {
      setLoading(false)
    }
  }

  async function refreshMessages(ticketId: string) {
    if (!ticketId) return
    try {
      const res = await fetch(`/api/v1/portal/support/${ticketId}/messages`)
      const body = await res.json().catch(() => ({}))
      if (res.ok) setMessages(body.data ?? [])
    } catch {}
  }

  useEffect(() => {
    if (!open) return
    refreshTickets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !selectedId) {
      setMessages([])
      return
    }
    refreshMessages(selectedId)
    const id = window.setInterval(() => refreshMessages(selectedId), 45_000)
    return () => window.clearInterval(id)
  }, [open, selectedId])

  async function createTicket() {
    if (!subject.trim() || !description.trim()) return
    setSaving(true)
    setError('')
    try {
      const sourceUrl = window.location.href
      const sourcePath = window.location.pathname
      const priority: SupportPriority = category === 'urgent' ? 'urgent' : 'normal'
      const res = await fetch('/api/v1/portal/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, priority, subject, description, sourceUrl, sourcePath }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Could not create support ticket')
      setSubject('')
      setDescription('')
      setCategory('question')
      await refreshTickets(body.data.id)
      await refreshMessages(body.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create support ticket')
    } finally {
      setSaving(false)
    }
  }

  async function sendReply() {
    if (!selectedId || !reply.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/portal/support/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: reply }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Could not send message')
      setReply('')
      await refreshTickets(selectedId)
      await refreshMessages(selectedId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName}>
        <span className="material-symbols-outlined text-[18px]">support_agent</span>
        <span>Need help?</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[80]">
          <button
            type="button"
            aria-label="Close support"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-[720px] overflow-y-auto border-l border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] shadow-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="eyebrow !text-[10px]">Support</p>
                <h2 className="font-display text-2xl">How can we help?</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]"
                aria-label="Close support"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </header>

            <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1.1fr]">
              <section className="space-y-4">
                <div className="bento-card p-4">
                  <h3 className="text-sm font-semibold">Create a ticket</h3>
                  <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                    We reply asynchronously. Urgent tickets are flagged for faster triage.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {CATEGORY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setCategory(option.value)}
                        className={[
                          'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                          category === option.value
                            ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                            : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]',
                        ].join(' ')}
                      >
                        <span className="material-symbols-outlined text-[17px]">{option.icon}</span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <input
                    className="pib-input mt-4"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Short summary"
                    maxLength={140}
                  />
                  <textarea
                    className="pib-input mt-3 min-h-32 resize-y"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Tell us what happened, what you expected, and where you were in the portal."
                  />
                  <button
                    type="button"
                    disabled={saving || !subject.trim() || !description.trim()}
                    onClick={createTicket}
                    className="btn-pib-accent mt-3 w-full justify-center disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="material-symbols-outlined text-[18px]">add_comment</span>
                    {saving ? 'Creating...' : 'Create ticket'}
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Your tickets</h3>
                    {loading && <span className="text-xs text-[var(--color-pib-text-muted)]">Loading...</span>}
                  </div>
                  {tickets.length === 0 && !loading ? (
                    <p className="rounded-lg border border-dashed border-[var(--color-pib-line)] p-4 text-sm text-[var(--color-pib-text-muted)]">
                      No tickets yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {tickets.map((ticket) => (
                        <button
                          key={ticket.id}
                          type="button"
                          onClick={() => setSelectedId(ticket.id)}
                          className={[
                            'w-full rounded-lg border p-3 text-left transition-colors',
                            selectedId === ticket.id
                              ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
                              : 'border-[var(--color-pib-line)] hover:bg-white/[0.04]',
                          ].join(' ')}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-2 text-sm font-medium">{ticket.subject}</p>
                            <span className="pib-pill shrink-0 !text-[10px]">{STATUS_LABEL[ticket.status]}</span>
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs text-[var(--color-pib-text-muted)]">{ticket.lastMessagePreview}</p>
                          <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{ticketTime(ticket)}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="bento-card flex min-h-[520px] flex-col p-0">
                {selectedTicket ? (
                  <>
                    <div className="border-b border-[var(--color-pib-line)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                            {selectedTicket.category.replace('_', ' ')}
                          </p>
                          <h3 className="mt-1 font-display text-xl leading-tight">{selectedTicket.subject}</h3>
                        </div>
                        <span className="pib-pill shrink-0">{STATUS_LABEL[selectedTicket.status]}</span>
                      </div>
                    </div>
                    <div className="flex-1 space-y-3 overflow-y-auto p-4">
                      {messages.map((message) => {
                        const mine = message.authorRole === 'client'
                        return (
                          <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                            <div
                              className={[
                                'max-w-[86%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                                mine
                                  ? 'rounded-br-md bg-[var(--color-pib-accent)] text-black'
                                  : 'rounded-bl-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text)]',
                              ].join(' ')}
                            >
                              <p className="mb-1 text-[10px] font-mono uppercase tracking-widest opacity-70">{mine ? 'You' : message.authorName}</p>
                              <p className="whitespace-pre-wrap">{message.body}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="border-t border-[var(--color-pib-line)] p-3">
                      <div className="flex gap-2">
                        <input
                          className="pib-input flex-1 !rounded-full !py-2.5"
                          value={reply}
                          onChange={(event) => setReply(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') sendReply()
                          }}
                          placeholder="Add a reply..."
                        />
                        <button
                          type="button"
                          onClick={sendReply}
                          disabled={saving || !reply.trim()}
                          className="btn-pib-accent disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--color-pib-text-muted)]">
                    Select a ticket to view the conversation.
                  </div>
                )}
              </section>
            </div>
            {error && <p className="mx-5 mb-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
          </aside>
        </div>
      )}
    </>
  )
}
