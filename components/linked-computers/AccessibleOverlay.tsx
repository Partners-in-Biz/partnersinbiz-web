'use client'

import { type ReactNode, useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function AccessibleDialog({ label, onClose, children, className = 'w-full max-w-md rounded-xl bg-[var(--color-card)] p-5' }: { label: string; onClose(): void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], ' + FOCUSABLE)
    first?.focus()
    return () => opener.current?.focus()
  }, [])
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (!items.length) return
    const first = items[0], last = items.at(-1)!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return <div ref={ref} role="dialog" aria-modal="true" aria-label={label} onKeyDown={keyDown} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className={className}>{children}</div></div>
}

export function AccessibleMenu({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => { opener.current = document.activeElement as HTMLElement; ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); return () => opener.current?.focus() }, [])
  return <div ref={ref} role="menu" aria-label={label} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }} className="fixed bottom-6 right-6 z-40 flex flex-col gap-2 rounded-xl border bg-[var(--color-card)] p-3">{children}</div>
}
