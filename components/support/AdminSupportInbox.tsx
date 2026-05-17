'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupportMessage, SupportPriority, SupportStatus, SupportTicket } from '@/lib/support/types'

const STATUS_LABEL: Record<SupportStatus, string> = {
  new: 'New',
  waiting_on_us: 'Waiting on us',
  waiting_on_client: 'Waiting on client',
  resolved: 'Resolved',
}

const STATUS_OPTIONS: SupportStatus[] = ['new', 'waiting_on_us', 'waiting_on_client', 'resolved']
const PRIORITY_OPTIONS: SupportPriority[] = ['low', 'normal', 'high', 'urgent']

function formatTime(value: unknown) {
  if (!value || typeof value !== 'string') return 'No timestamp'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function AdminSupportInbox() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [reply, setReply] = useState('')
  const [filter, setFilter] = useState<SupportStatus | 'open'>('open')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedTicket = useMemo(() => tickets.find((ticket) => ticket.id === selectedId) ?? null, [tickets, selectedId])
  const visibleTickets = tickets.filter((ticket) => {
    if (filter === 'open') return ticket.status !== 'resolved'
    return ticket.status === filter
  })

  async function refreshTickets(nextSelectedId?: string) {
    setError('')
    try {
      const res = await fetch('/api/v1/admin/support')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Could not load support tickets')
      const nextTickets = body.data ?? []
      setTickets(nextTickets)
      const nextId = nextSelectedId || selectedId || nextTickets[0]?.id || ''
      setSelectedId(nextId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load support tickets')
    } finally {
      setLoading(false)
    }
  }

  async function refreshMessages(ticketId: string) {
    if (!ticketId) {
      setMessages([])
      return
    }
    const res = await fetch(`/api/v1/admin/support/${ticketId}/messages`)
    const body = await res.json().catch(() => ({}))
    if (res.ok) setMessages(body.data ?? [])
  }

  useEffect(() => {
    refreshTickets()
    const id = window.setInterval(() => refreshTickets(), 60_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    refreshMessages(selectedId)
  }, [selectedId])

  async function patchTicket(update: Partial<Pick<SupportTicket, 'status' | 'priority' | 'assigneeAgentId' | 'hermesSummary'>>) {
    if (!selectedId) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/admin/support/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Could not update ticket')
      await refreshTickets(selectedId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update ticket')
    } finally {
      setSaving(false)
    }
  }

  async function sendReply() {
    if (!selectedId || !reply.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/admin/support/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: reply }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Could not send reply')
      setReply('')
      await refreshTickets(selectedId)
      await refreshMessages(selectedId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reply')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Client support</p>
          <h1 className="pib-page-title mt-2">Support Inbox</h1>
          <p className="pib-page-sub max-w-2xl">
            Async client support tickets with a chat-like thread and room for Hermes-assisted triage.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['open', ...STATUS_OPTIONS] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={[
                'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                filter === status
                  ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                  : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]',
              ].join(' ')}
            >
              {status === 'open' ? 'Open' : STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <section className="space-y-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => <div key={index} className="pib-skeleton h-28" />)
          ) : visibleTickets.length === 0 ? (
            <div className="bento-card p-6 text-center text-sm text-[var(--color-pib-text-muted)]">No support tickets in this view.</div>
          ) : (
            visibleTickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setSelectedId(ticket.id)}
                className={[
                  'w-full rounded-lg border p-4 text-left transition-colors',
                  selectedId === ticket.id
                    ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
                    : 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]">{ticket.orgName ?? ticket.orgId}</p>
                    <h2 className="mt-1 line-clamp-2 text-sm font-semibold">{ticket.subject}</h2>
                  </div>
                  <span className="pib-pill shrink-0 !text-[10px]">{ticket.priority}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-[var(--color-pib-text-muted)]">{ticket.lastMessagePreview || ticket.description}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                  <span>{STATUS_LABEL[ticket.status]}</span>
                  <span>{formatTime(ticket.updatedAt)}</span>
                </div>
              </button>
            ))
          )}
        </section>

        <section className="bento-card min-h-[640px] p-0">
          {selectedTicket ? (
            <div className="flex min-h-[640px] flex-col">
              <div className="border-b border-[var(--color-pib-line)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                      {selectedTicket.requesterName} · {selectedTicket.requesterEmail || selectedTicket.orgName}
                    </p>
                    <h2 className="mt-2 font-display text-2xl leading-tight">{selectedTicket.subject}</h2>
                    {selectedTicket.sourcePath && (
                      <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Reported from {selectedTicket.sourcePath}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={selectedTicket.status}
                      disabled={saving}
                      onChange={(event) => patchTicket({ status: event.target.value as SupportStatus })}
                      className="pib-input !w-auto !py-2 text-xs"
                    >
                      {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
                    </select>
                    <select
                      value={selectedTicket.priority}
                      disabled={saving}
                      onChange={(event) => patchTicket({ priority: event.target.value as SupportPriority })}
                      className="pib-input !w-auto !py-2 text-xs"
                    >
                      {PRIORITY_OPTIONS.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid gap-0 lg:grid-cols-[1fr_260px]">
                <div className="flex min-h-[520px] flex-col">
                  <div className="flex-1 space-y-3 overflow-y-auto p-5">
                    {messages.map((message) => {
                      const client = message.authorRole === 'client'
                      return (
                        <div key={message.id} className={`flex ${client ? 'justify-start' : 'justify-end'}`}>
                          <div
                            className={[
                              'max-w-[86%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                              client
                                ? 'rounded-bl-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)]'
                                : 'rounded-br-md bg-[var(--color-pib-accent)] text-black',
                            ].join(' ')}
                          >
                            <p className="mb-1 text-[10px] font-mono uppercase tracking-widest opacity-70">{message.authorName}</p>
                            <p className="whitespace-pre-wrap">{message.body}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="border-t border-[var(--color-pib-line)] p-4">
                    <textarea
                      className="pib-input min-h-24 resize-y"
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      placeholder="Reply to the client..."
                    />
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={sendReply}
                        disabled={saving || !reply.trim()}
                        className="btn-pib-accent disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <span className="material-symbols-outlined text-[18px]">send</span>
                        Send reply
                      </button>
                    </div>
                  </div>
                </div>

                <aside className="border-t border-[var(--color-pib-line)] p-4 lg:border-l lg:border-t-0">
                  <h3 className="text-sm font-semibold">Hermes triage</h3>
                  <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                    Internal only for now. Add a summary or suggested response before client-facing automation is enabled.
                  </p>
                  <textarea
                    className="pib-input mt-4 min-h-40 resize-y text-sm"
                    defaultValue={selectedTicket.hermesSummary ?? ''}
                    onBlur={(event) => {
                      const value = event.target.value.trim()
                      if (value !== (selectedTicket.hermesSummary ?? '')) patchTicket({ hermesSummary: value })
                    }}
                    placeholder="Suggested reply, diagnosis, or routing notes..."
                  />
                  <button
                    type="button"
                    onClick={() => patchTicket({ assigneeAgentId: selectedTicket.assigneeAgentId ? '' : 'hermes' })}
                    className="mt-3 w-full rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
                  >
                    {selectedTicket.assigneeAgentId ? 'Unassign Hermes' : 'Mark for Hermes'}
                  </button>
                </aside>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[640px] items-center justify-center p-8 text-sm text-[var(--color-pib-text-muted)]">
              Select a ticket to start.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
