'use client'

import { useState } from 'react'

interface Message {
  id: string
  text: string
  direction: 'inbound' | 'outbound'
  authorName: string
  createdAt: any
}

interface Props {
  messages: Message[]
  enquiryId: string
  onSent: (msg: Message) => void
}

export default function MessageThread({ messages, enquiryId, onSent }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    if (!text.trim()) return
    setSending(true)
    const res = await fetch('/api/v1/portal/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enquiryId, text: text.trim() }),
    })
    if (res.ok) {
      const body = await res.json()
      onSent({
        id: body.data.id,
        text: text.trim(),
        direction: 'inbound',
        authorName: 'You',
        createdAt: null,
      })
      setText('')
    }
    setSending(false)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="text-[var(--color-pib-text-muted)] text-sm text-center py-8">
            No messages yet. Send us an update below.
          </p>
        )}
        {messages.map((msg) => {
          const mine = msg.direction === 'inbound'
          return (
            <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={[
                  'max-w-[80%] px-4 py-2.5 rounded-md text-sm leading-snug',
                  mine
                    ? 'bg-[var(--color-pib-accent)] text-black rounded-br-md'
                    : 'bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] text-[var(--color-pib-text)] rounded-bl-md',
                ].join(' ')}
              >
                <p className="text-[10px] font-mono uppercase tracking-widest opacity-70 mb-1">{msg.authorName}</p>
                <p>{msg.text}</p>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-2">
        <input aria-label="Send a message or update"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Send a message or update…"
          className="pib-input flex-1 rounded-md !py-2.5"
        />
        <button onClick={send} disabled={sending || !text.trim()} className="pib-btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
