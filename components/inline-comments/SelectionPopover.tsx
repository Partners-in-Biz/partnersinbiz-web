'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

interface Props {
  /** The element whose text selection we listen to. */
  containerRef: RefObject<HTMLElement | null>
  onComment: (selectedText: string) => void
}

/**
 * Floating "💬 Comment" button that appears next to the user's text selection
 * when the selection is non-empty AND falls inside `containerRef`. Click the
 * button to surface the comment composer with the selected text as anchor.
 */
export function SelectionPopover({ containerRef, onComment }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [text, setText] = useState('')
  const lastSelRef = useRef<string>('')

  useEffect(() => {
    function update() {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        setPos(null)
        return
      }
      const range = sel.getRangeAt(0)
      const container = containerRef.current
      if (!container) {
        setPos(null)
        return
      }
      // Selection must be entirely inside our container
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
        setPos(null)
        return
      }
      const selectedText = sel.toString().trim()
      if (selectedText.length < 3) {
        setPos(null)
        return
      }
      // Avoid flicker when same selection is reported twice
      if (selectedText === lastSelRef.current && pos) return
      lastSelRef.current = selectedText
      const rect = range.getBoundingClientRect()
      // Fixed positioning  -  viewport-relative, no scroll offset needed.
      const top = rect.top - 44
      const left = rect.left + rect.width / 2 - 80
      setPos({ top: Math.max(8, top), left: Math.max(8, left) })
      setText(selectedText)
    }

    document.addEventListener('selectionchange', update)
    document.addEventListener('mouseup', update)
    return () => {
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('mouseup', update)
    }
  }, [containerRef, pos])

  if (!pos) return null

  return (
    <div
      role="toolbar"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 50,
      }}
      className="pointer-events-auto"
    >
      <button
        type="button"
        onMouseDown={e => {
          // Prevent the click from clearing the selection before we read it
          e.preventDefault()
        }}
        onClick={() => {
          onComment(text)
          window.getSelection()?.removeAllRanges()
          setPos(null)
        }}
        className="px-3 py-1.5 rounded-md text-xs font-label border transition-colors flex items-center gap-1.5"
        style={{
          background: 'var(--org-accent, var(--color-pib-accent))',
          color: '#000',
          borderColor: 'var(--org-accent, var(--color-pib-accent))',
        }}
      >
        <span aria-hidden>💬</span>
        Comment on selection
      </button>
    </div>
  )
}
