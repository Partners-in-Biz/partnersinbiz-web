'use client'

/* eslint-disable @next/next/no-img-element -- Confirmed browser screenshot artifacts are intentionally rendered without Next image optimization. */

import { type FormEvent, type MouseEvent, useEffect, useMemo, useState } from 'react'
import type { WorkbenchBrowserTarget } from '@/lib/messages/workbench/types'

const MAX_ANNOTATION_LENGTH = 1_000

function privateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::' || host === '::1' || host === '0.0.0.0') return true

  // Literal IPv6 addresses are conservatively blocked in observer mode. A
  // public tunnel hostname remains available for legitimate remote previews,
  // while this avoids an incomplete special-purpose IPv6 range allowlist.
  if (host.includes(':')) return true

  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
  if (!ipv4) return false
  const [a, b, c] = ipv4
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

function safeObservedUrl(value: string): { url: string | null; error: string | null } {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { url: null, error: 'Only HTTP and HTTPS targets are supported.' }
    if (parsed.username || parsed.password) return { url: null, error: 'Credentialed URLs are blocked.' }
    if (privateHostname(parsed.hostname)) return { url: null, error: 'Local and private-network targets are blocked. Use a public tunnel URL.' }
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return { url: null, error: 'Same-origin application URLs are blocked in the observer panel.' }
    return { url: parsed.toString(), error: null }
  } catch {
    return { url: null, error: 'Enter a valid HTTP or HTTPS URL.' }
  }
}

function boundedPlainText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maxLength)
}

export function formatDesignAnnotation(input: {
  title?: string | null
  url?: string | null
  xPct: number
  yPct: number
  note: string
}): string {
  const title = boundedPlainText(input.title || 'Browser preview', 200)
  const url = boundedPlainText(input.url || '', 500)
  const note = boundedPlainText(input.note, MAX_ANNOTATION_LENGTH)
  const point = `${Math.round(Math.min(100, Math.max(0, input.xPct)))}%, ${Math.round(Math.min(100, Math.max(0, input.yPct)))}%`
  return [
    '[Design note]',
    `Target: ${title}`,
    ...(url ? [`URL: ${url}`] : []),
    `Point: ${point}`,
    `Feedback: ${note}`,
  ].join('\n')
}

/** A committed Design Mode note, pinned to a point on whichever frame/URL was prepared when it was added. */
export interface WorkbenchDesignPin {
  id: string
  xPct: number
  yPct: number
  note: string
  url: string | null
  title: string
}

function createPinId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `pin-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export interface WorkbenchBrowserPanelProps {
  targets: WorkbenchBrowserTarget[]
  /** Adds a Design Mode note (or several, newline-joined) to the existing chat composer. It never sends the message. */
  onAddToChat?: (text: string) => void
}

export function WorkbenchBrowserPanel({ targets, onAddToChat }: WorkbenchBrowserPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(targets[0]?.id ?? null)
  const [draftUrl, setDraftUrl] = useState('')
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null)
  const [preparedImageUrl, setPreparedImageUrl] = useState<string | null>(null)
  const [preparedTitle, setPreparedTitle] = useState('Local app preview')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [designMode, setDesignMode] = useState(false)
  // Draft point/note being composed on the current frame — cleared on frame/target changes.
  const [draftPoint, setDraftPoint] = useState<{ xPct: number; yPct: number } | null>(null)
  const [draftNote, setDraftNote] = useState('')
  // Committed pins — intentionally NOT reset by live frame updates or target switches, only by "Clear pins".
  const [pins, setPins] = useState<WorkbenchDesignPin[]>([])

  const frames = useMemo(() => targets.filter((target) => Boolean(target.imageUrl)), [targets])
  const latestFrame = frames[frames.length - 1]

  useEffect(() => {
    if (!targets.some((target) => target.id === selectedId)) setSelectedId(targets[0]?.id ?? null)
  }, [selectedId, targets])

  useEffect(() => {
    if (!streaming || !latestFrame?.imageUrl) return
    const result = safeObservedUrl(latestFrame.imageUrl)
    if (!result.url) {
      setStreaming(false)
      setValidationError(result.error)
      return
    }
    setSelectedId(latestFrame.id)
    setDraftUrl(latestFrame.imageUrl)
    setPreparedUrl(result.url)
    setPreparedImageUrl(result.url)
    setPreparedTitle(latestFrame.title || 'Agent browser frame')
    setValidationError(null)
    setDraftPoint(null)
  }, [latestFrame?.id, latestFrame?.imageUrl, latestFrame?.title, streaming])

  const selected = targets.find((target) => target.id === selectedId) ?? targets[0]

  const prepareTarget = (event: FormEvent) => {
    event.preventDefault()
    const result = safeObservedUrl(draftUrl)
    setValidationError(result.error)
    setPreparedUrl(result.url)
    setPreparedImageUrl(result.url && selected?.imageUrl === draftUrl ? result.url : null)
    setPreparedTitle(selected && (selected.url === draftUrl || selected.imageUrl === draftUrl)
      ? selected.title || (selected.imageUrl ? 'Agent browser frame' : 'Local app preview')
      : 'Local app preview')
    setStreaming(false)
    setDesignMode(false)
    setDraftPoint(null)
  }

  const toggleStream = () => {
    if (streaming) {
      setStreaming(false)
      return
    }
    if (!latestFrame?.imageUrl) return
    const result = safeObservedUrl(latestFrame.imageUrl)
    if (!result.url) {
      setValidationError(result.error)
      return
    }
    setSelectedId(latestFrame.id)
    setDraftUrl(latestFrame.imageUrl)
    setPreparedUrl(result.url)
    setPreparedImageUrl(result.url)
    setPreparedTitle(latestFrame.title || 'Agent browser frame')
    setValidationError(null)
    setDesignMode(false)
    setDraftPoint(null)
    setStreaming(true)
  }

  const capturePoint = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    setDraftPoint({
      xPct: Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
      yPct: Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100)),
    })
  }

  const addDraftPin = () => {
    if (!draftPoint || !draftNote.trim()) return
    setPins((prev) => [...prev, {
      id: createPinId(),
      xPct: draftPoint.xPct,
      yPct: draftPoint.yPct,
      note: draftNote.trim(),
      url: preparedUrl,
      title: preparedTitle,
    }])
    setDraftNote('')
    setDraftPoint(null)
  }

  const removePin = (id: string) => setPins((prev) => prev.filter((pin) => pin.id !== id))

  const clearPins = () => setPins([])

  const addPinToChat = (pin: WorkbenchDesignPin) => {
    onAddToChat?.(formatDesignAnnotation({ title: pin.title, url: pin.url, xPct: pin.xPct, yPct: pin.yPct, note: pin.note }))
  }

  const addAllPinsToChat = () => {
    if (!onAddToChat || pins.length === 0) return
    onAddToChat(pins
      .map((pin) => formatDesignAnnotation({ title: pin.title, url: pin.url, xPct: pin.xPct, yPct: pin.yPct, note: pin.note }))
      .join('\n\n'))
  }

  const hasPreparedTarget = Boolean(preparedImageUrl || preparedUrl)

  return (
    <div data-testid="workbench-browser-panel" className="flex h-full min-h-0 flex-col">
      <form onSubmit={prepareTarget} className="flex shrink-0 gap-1 border-b border-[var(--color-card-border)] p-2">
        <input
          aria-label="Browser target URL"
          value={draftUrl}
          onChange={(event) => {
            setDraftUrl(event.target.value)
            setValidationError(null)
            setPreparedUrl(null)
            setPreparedImageUrl(null)
            setStreaming(false)
            setDesignMode(false)
            setDraftPoint(null)
          }}
          placeholder="https://public-preview.example"
          className="min-h-9 min-w-0 flex-1 rounded-md border border-[var(--color-card-border)] bg-black/20 px-2 font-mono text-[11px] text-[var(--color-pib-text)] outline-none focus:border-primary/60"
        />
        <button type="submit" className="min-h-9 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]">Prepare</button>
      </form>

      {(frames.length > 0 || (hasPreparedTarget && onAddToChat)) && (
        <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-[var(--color-card-border)] px-2 py-1.5">
          {frames.length > 0 && (
            <button
              type="button"
              aria-label={streaming ? 'Pause live stream' : 'Start live stream'}
              onClick={toggleStream}
              className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-[10px] ${streaming ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]'}`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{streaming ? 'pause' : 'play_arrow'}</span>
              {streaming ? `Live · ${frames.length} frames` : 'Start live stream'}
            </button>
          )}
          {hasPreparedTarget && onAddToChat && (
            <button
              type="button"
              aria-label={designMode ? 'Disable Design Mode' : 'Enable Design Mode'}
              aria-pressed={designMode}
              onClick={() => { setDesignMode((value) => !value); setDraftPoint(null) }}
              className={`ml-auto inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-[10px] ${designMode ? 'border-primary/40 bg-primary/10 text-primary' : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]'}`}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">design_services</span>
              Design Mode
            </button>
          )}
        </div>
      )}

      {validationError && <p role="alert" className="shrink-0 border-b border-red-400/20 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-200">{validationError}</p>}

      {targets.length > 0 && (
        <div className="max-h-[24%] shrink-0 overflow-y-auto border-b border-[var(--color-card-border)]">
          {targets.map((target) => {
            const active = target.id === selected?.id
            return (
              <button
                key={target.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSelectedId(target.id)
                  setDraftUrl(target.url ?? target.imageUrl ?? '')
                  setPreparedUrl(null)
                  setPreparedImageUrl(null)
                  setValidationError(null)
                  setStreaming(false)
                  setDesignMode(false)
                  setDraftPoint(null)
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] ${active ? 'bg-primary/10 text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.04]'}`}
              >
                <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[14px] text-primary">{target.imageUrl && !target.url ? 'image' : 'public'}</span>
                <span className="min-w-0 flex-1 truncate">{target.title || target.url || 'Screenshot'}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col bg-black/20 p-2">
        {preparedImageUrl || preparedUrl ? (
          <>
            <div className="relative min-h-[220px] flex-1 overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-black/30">
              {preparedImageUrl ? (
                <img src={preparedImageUrl} alt={preparedTitle} referrerPolicy="no-referrer" className="h-full w-full object-contain" />
              ) : preparedUrl ? (
                <iframe
                  src={preparedUrl}
                  title="Local app preview"
                  sandbox="allow-forms allow-modals allow-popups allow-scripts"
                  referrerPolicy="no-referrer"
                  className="h-full min-h-[220px] w-full border-0 bg-white"
                />
              ) : null}

              {designMode && (
                <button
                  type="button"
                  aria-label="Design Mode canvas"
                  onClick={capturePoint}
                  className="absolute inset-0 cursor-crosshair bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                >
                  {pins.map((pin, index) => (
                    <span
                      key={pin.id}
                      aria-hidden="true"
                      className="absolute grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white/70 bg-white/20 text-[8px] font-bold text-white shadow-[0_0_0_2px_rgba(0,0,0,0.45)]"
                      style={{ left: `${pin.xPct}%`, top: `${pin.yPct}%` }}
                    >
                      {index + 1}
                    </span>
                  ))}
                  {draftPoint && (
                    <span
                      aria-hidden="true"
                      className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-[0_0_0_3px_rgba(0,0,0,0.45)]"
                      style={{ left: `${draftPoint.xPct}%`, top: `${draftPoint.yPct}%` }}
                    />
                  )}
                </button>
              )}
            </div>

            <div className="mt-2 flex shrink-0 items-center justify-between gap-2 text-[10px] text-[var(--color-pib-text-muted)]">
              <span>{preparedImageUrl ? (streaming ? 'Following agent screenshot events.' : 'Confirmed screenshot artifact.') : 'Sandboxed public preview. If framing is blocked, open it in a new tab.'}</span>
              {preparedUrl && (
                <a href={preparedUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="shrink-0 text-primary hover:underline">Open preview in new tab</a>
              )}
            </div>

            {designMode && (
              <div className="mt-2 shrink-0 space-y-2">
                <div className="rounded-md border border-primary/25 bg-primary/[0.06] p-2">
                  <p className="mb-1 text-[10px] text-[var(--color-pib-text-muted)]">Click the preview, describe the change, then add a pin. Nothing is sent automatically.</p>
                  <textarea
                    aria-label="Design annotation"
                    value={draftNote}
                    maxLength={MAX_ANNOTATION_LENGTH}
                    onChange={(event) => setDraftNote(event.target.value)}
                    placeholder={draftPoint ? 'Describe the requested change…' : 'Choose a point on the preview first…'}
                    className="min-h-16 w-full resize-y rounded-md border border-[var(--color-card-border)] bg-black/20 p-2 text-[11px] text-[var(--color-pib-text)] outline-none focus:border-primary/60"
                  />
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[9px] text-[var(--color-pib-text-muted)]">
                      {draftPoint ? `Point ${Math.round(draftPoint.xPct)}%, ${Math.round(draftPoint.yPct)}%` : 'No point selected'}
                    </span>
                    <button
                      type="button"
                      aria-label="Add pin"
                      onClick={addDraftPin}
                      disabled={!draftPoint || !draftNote.trim()}
                      className="min-h-7 rounded-md border border-primary/35 bg-primary/10 px-2 text-[10px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Add pin
                    </button>
                  </div>
                </div>

                {pins.length > 0 && (
                  <div data-testid="workbench-design-pin-list" className="rounded-md border border-[var(--color-card-border)] bg-black/20 p-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-medium text-[var(--color-pib-text)]">{pins.length} pin{pins.length === 1 ? '' : 's'}</p>
                      <div className="flex items-center gap-1.5">
                        {onAddToChat && (
                          <button
                            type="button"
                            aria-label="Add all to chat"
                            onClick={addAllPinsToChat}
                            className="min-h-6 rounded-md border border-primary/35 bg-primary/10 px-2 text-[9px] font-medium text-primary hover:bg-primary/15"
                          >
                            Add all to chat
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Clear pins"
                          onClick={clearPins}
                          className="min-h-6 rounded-md border border-white/10 px-2 text-[9px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]"
                        >
                          Clear pins
                        </button>
                      </div>
                    </div>
                    <ul className="space-y-1">
                      {pins.map((pin, index) => (
                        <li key={pin.id} className="flex items-start gap-2 rounded-md border border-white/5 bg-black/20 px-2 py-1.5">
                          <span aria-hidden="true" className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border border-white/30 text-[8px] font-bold text-[var(--color-pib-text-muted)]">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[9px] text-[var(--color-pib-text-muted)]">{Math.round(pin.xPct)}%, {Math.round(pin.yPct)}%</p>
                            <p className="truncate text-[10px] text-[var(--color-pib-text)]" title={pin.note}>{pin.note}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {onAddToChat && (
                              <button
                                type="button"
                                aria-label={`Add pin ${index + 1} to chat`}
                                onClick={() => addPinToChat(pin)}
                                className="grid h-6 w-6 place-items-center rounded-full text-primary hover:bg-primary/10"
                              >
                                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">add_comment</span>
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`Remove pin ${index + 1}`}
                              onClick={() => removePin(pin.id)}
                              className="grid h-6 w-6 place-items-center rounded-full text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)]"
                            >
                              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[11px] text-[var(--color-pib-text-muted)]">
            <span aria-hidden="true" className="material-symbols-outlined text-[24px]">visibility_off</span>
            <p>Select an observed target, then choose Prepare. Targets and screenshots never load automatically.</p>
            <p className="text-[10px] opacity-80">Agent screenshot events can be followed as a live stream; public preview URLs can be embedded after validation.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default WorkbenchBrowserPanel
