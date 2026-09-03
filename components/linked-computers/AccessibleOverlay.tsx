'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusWithoutScroll(element: HTMLElement | null | undefined) {
  if (!element) return
  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
}

export function AccessibleDialog({ label, onClose, children, className = 'w-full max-w-md rounded-md bg-[var(--color-card)] p-5' }: { label: string; onClose(): void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    const overlay = ref.current
    const first = overlay?.querySelector<HTMLElement>('[autofocus], ' + FOCUSABLE)
    // preventScroll: focusing a control near the bottom of a tall dialog must
    // not scroll the document / overlay and shove the whole popup off-screen
    // (classic New conversation → pick agent bug).
    if (first) focusWithoutScroll(first)
    else focusWithoutScroll(overlay)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const background: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = []
    let current: HTMLElement | null = overlay
    while (current?.parentElement) {
      const parent: HTMLElement = current.parentElement
      for (const sibling of Array.from(parent.children)) {
        if (sibling === current || !(sibling instanceof HTMLElement)) continue
        background.push({
          element: sibling,
          inert: sibling.hasAttribute('inert'),
          ariaHidden: sibling.getAttribute('aria-hidden'),
        })
        sibling.setAttribute('inert', '')
        sibling.setAttribute('aria-hidden', 'true')
      }
      if (parent === document.body) break
      current = parent
    }
    return () => {
      document.body.style.overflow = previousOverflow
      for (const state of background) {
        if (!state.inert) state.element.removeAttribute('inert')
        if (state.ariaHidden == null) state.element.removeAttribute('aria-hidden')
        else state.element.setAttribute('aria-hidden', state.ariaHidden)
      }
      focusWithoutScroll(opener.current)
    }
  }, [])
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (!items.length) return
    const first = items[0], last = items.at(-1)!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); focusWithoutScroll(last) }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); focusWithoutScroll(first) }
  }
  // Portal to body so parent overflow/transform cannot trap `fixed` positioning.
  // Backdrop never scrolls. Tall content must scroll inside the panel (or an
  // internal body the caller provides with overflow-hidden + flex-col).
  const node = (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={keyDown}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden overscroll-none bg-black/60 p-2 sm:items-center sm:p-4 [overflow-anchor:none]"
    >
      <div
        data-testid="accessible-dialog-panel"
        className={cn(
          // Default: allow simple dialogs to scroll their own content.
          // Sticky-footer callers (New conversation) pass overflow-hidden + flex-col
          // so only an internal body scrolls  -  never the whole card.
          'max-h-[calc(100dvh-1rem)] min-h-0 w-full overflow-y-auto overscroll-contain [overflow-anchor:none] sm:max-h-[calc(100dvh-2rem)]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return node
  return createPortal(node, document.body)
}

export function AccessibleMenu({ id, label, onClose, children }: { id: string; label: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement
    focusWithoutScroll(ref.current?.querySelector<HTMLElement>('[role="menuitem"]'))
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    document.addEventListener('mousedown', outside)
    return () => { document.removeEventListener('mousedown', outside); focusWithoutScroll(opener.current) }
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
    if (next != null) { event.preventDefault(); focusWithoutScroll(items[next]) }
  }
  return <div id={id} ref={ref} role="menu" aria-label={label} onKeyDown={keyDown} className="fixed bottom-6 right-6 z-40 flex flex-col gap-2 rounded-md border bg-[var(--color-card)] p-3">{children}</div>
}
