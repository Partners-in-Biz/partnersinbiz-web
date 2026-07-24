'use client'

/* eslint-disable @next/next/no-img-element -- Browser previews use arbitrary agent-provided screenshot URLs. */

import { type FormEvent, useEffect, useState } from 'react'
import type { WorkbenchBrowserTarget } from '@/lib/messages/workbench/types'

function safeHttpUrl(url?: string): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export function WorkbenchBrowserPanel({ targets }: { targets: WorkbenchBrowserTarget[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(targets[0]?.id ?? null)
  const [url, setUrl] = useState(targets[0]?.url ?? '')

  useEffect(() => {
    if (!targets.some((target) => target.id === selectedId)) {
      setSelectedId(targets[0]?.id ?? null)
      setUrl(targets[0]?.url ?? '')
    }
  }, [selectedId, targets])

  const selected = targets.find((target) => target.id === selectedId) ?? targets[0]
  const previewUrl = safeHttpUrl(url) ?? safeHttpUrl(selected?.url)
  const navigate = (event: FormEvent) => {
    event.preventDefault()
    const safe = safeHttpUrl(url)
    if (safe) setUrl(safe)
  }

  return (
    <div data-testid="workbench-browser-panel" className="flex h-full min-h-0 flex-col">
      <form onSubmit={navigate} className="flex shrink-0 gap-1 border-b border-[var(--color-card-border)] p-2">
        <input
          aria-label="Browser preview URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://preview.example"
          className="min-h-9 min-w-0 flex-1 rounded-md border border-[var(--color-card-border)] bg-black/20 px-2 font-mono text-[11px] text-[var(--color-pib-text)] outline-none focus:border-primary/60"
        />
        <button type="submit" className="min-h-9 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]">Go</button>
      </form>
      {targets.length > 0 && (
        <div className="max-h-[28%] shrink-0 overflow-y-auto border-b border-[var(--color-card-border)]">
          {targets.map((target) => {
            const active = target.id === selected?.id
            return (
              <button
                key={target.id}
                type="button"
                aria-pressed={active}
                onClick={() => { setSelectedId(target.id); setUrl(target.url ?? '') }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] ${active ? 'bg-primary/10 text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.04]'}`}
              >
                <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[14px] text-primary">{target.imageUrl && !target.url ? 'image' : 'public'}</span>
                <span className="min-w-0 flex-1 truncate">{target.title || target.url || 'Screenshot'}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-black/20 p-2">
        {previewUrl ? (
          <iframe title={selected?.title ?? previewUrl} src={previewUrl} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" className="h-full min-h-[240px] w-full rounded-lg border border-[var(--color-card-border)] bg-white" />
        ) : selected?.imageUrl ? (
          <img src={selected.imageUrl} alt={selected.title ?? 'Browser preview'} className="max-h-full w-full rounded-lg border border-[var(--color-card-border)] object-contain" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[11px] text-[var(--color-pib-text-muted)]">
            <span aria-hidden="true" className="material-symbols-outlined text-[24px]">visibility_off</span>
            Paste an HTTP or HTTPS URL, or wait for the agent to surface a preview target.
          </div>
        )}
      </div>
    </div>
  )
}

export default WorkbenchBrowserPanel
