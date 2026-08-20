'use client'

import { BOT_MODE_COPY } from '@/lib/messages/experience-mode'
import type { BotInboxThread } from '@/lib/messages/bot-channel'

export function BotInboxRail({
  threads,
  bots,
  activeId,
  onOpenThread,
  onCreateThread,
}: {
  threads: BotInboxThread[]
  bots: Array<{ id: string; name: string }>
  activeId?: string | null
  onOpenThread: (threadId: string) => void
  onCreateThread?: (fromAgentId: string, toAgentId: string) => void
}) {
  return (
    <section data-testid="bot-inbox-rail" className="flex min-h-0 flex-col gap-1">
      <div className="flex items-center justify-between px-1 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]/75">
        <span>{BOT_MODE_COPY.inboxLabel}</span>
        <span className="font-mono text-[10px] tracking-normal">{threads.length}</span>
      </div>
      {threads.length === 0 ? (
        <p className="px-2 py-2 text-[11px] text-[var(--color-pib-text-muted)]">{BOT_MODE_COPY.inboxEmpty}</p>
      ) : threads.map((thread) => {
        const selected = thread.id === activeId
        return (
          <button
            key={thread.id}
            type="button"
            data-testid={`bot-inbox-thread-${thread.id}`}
            onClick={() => onOpenThread(thread.id)}
            className={`rounded-md border px-2 py-1.5 text-left ${
              selected ? 'border-primary/35 bg-primary/[0.08]' : 'border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.05]'
            }`}
          >
            <span className="block truncate text-[12px] font-semibold text-[var(--color-pib-text)]">{thread.title}</span>
            <span className="mt-0.5 block truncate text-[10px] text-[var(--color-pib-text-muted)]">
              {thread.status}
              {thread.preview ? ` · ${thread.preview}` : ''}
            </span>
          </button>
        )
      })}
      {onCreateThread && bots.length >= 2 && (
        <form
          className="mt-1 flex flex-col gap-1 rounded-md border border-white/[0.06] bg-black/10 p-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const fromAgentId = String(new FormData(form).get('fromAgentId') || '')
            const toAgentId = String(new FormData(form).get('toAgentId') || '')
            if (fromAgentId && toAgentId && fromAgentId !== toAgentId) onCreateThread(fromAgentId, toAgentId)
          }}
        >
          <label className="text-[10px] text-[var(--color-pib-text-muted)]">
            From
            <select name="fromAgentId" className="mt-0.5 h-8 w-full rounded border border-white/[0.08] bg-black/30 px-1 text-[11px] text-[var(--color-pib-text)]">
              {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-[var(--color-pib-text-muted)]">
            To
            <select name="toAgentId" defaultValue={bots[1]?.id} className="mt-0.5 h-8 w-full rounded border border-white/[0.08] bg-black/30 px-1 text-[11px] text-[var(--color-pib-text)]">
              {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
            </select>
          </label>
          <button type="submit" className="inline-flex h-8 items-center justify-center rounded-md border border-white/[0.1] text-[11px] text-[var(--color-pib-text)] hover:bg-white/[0.06]">
            Send to inbox
          </button>
        </form>
      )}
    </section>
  )
}
