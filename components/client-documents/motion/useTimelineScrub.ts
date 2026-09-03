'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Drives a vertical "fill" element's height as the user scrolls
 * through a containing section. The fill ref's `height` is set to a
 * 0–100% value matching how far the section has scrolled past the
 * top of the viewport. Useful for timeline progress bars.
 *
 * Not yet wired into TimelineBlock - keeping the hook available so
 * a later polish pass can drop a fill element into the timeline rail
 * and call this without further plumbing.
 */
export function useTimelineScrub(
  sectionRef: RefObject<HTMLElement | null>,
  fillRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const section = sectionRef.current
    const fill = fillRef.current
    if (!section || !fill) return

    function onScroll() {
      if (!section || !fill) return
      const rect = section.getBoundingClientRect()
      const total = rect.height
      const scrolled = Math.max(0, -rect.top)
      const pct = total > 0 ? Math.max(0, Math.min(1, scrolled / total)) : 0
      fill.style.height = `${pct * 100}%`
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [sectionRef, fillRef])
}
