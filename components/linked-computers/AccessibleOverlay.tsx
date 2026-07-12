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

export function AccessibleMenu({ id, label, onClose, children }: { id: string; label: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    document.addEventListener('mousedown', outside)
    return () => { document.removeEventListener('mousedown', outside); opener.current?.focus() }
  }, [onClose])
  function keyDown(event: React.KeyboardEvent) {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); onClose(); return }
    if (!items.length) return
    let next: number | null = null
    if (event.key === 'ArrowDown') next = (index + 1) % items.length
    if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = items.length - 1
    if (next != null) { event.preventDefault(); items[next].focus() }
  }
  return <div id={id} ref={ref} role="menu" aria-label={label} onKeyDown={keyDown} className="fixed bottom-6 right-6 z-40 flex flex-col gap-2 rounded-xl border bg-[var(--color-card)] p-3">{children}</div>
}
