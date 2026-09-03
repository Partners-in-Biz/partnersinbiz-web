'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Pins a numbered callout element to the top of the viewport while its
 * parent section is in view. The `numberRef` element switches between
 * `position: sticky; top: 80px` (while the section is in viewport) and
 * `position: static` (outside) as the user scrolls.
 *
 * Triggers when:
 * - sectionRect.top < 80   (section has scrolled past the sticky line)
 * - sectionRect.bottom > 200 (section is still occupying viewport)
 */
export function useStickyNumber(
  sectionRef: RefObject<HTMLElement | null>,
  numberRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const section = sectionRef.current
    const num = numberRef.current
    if (!section || !num) return

    function onScroll() {
      if (!section || !num) return
      const rect = section.getBoundingClientRect()
      const stick = rect.top < 80 && rect.bottom > 200
      num.style.position = stick ? 'sticky' : 'static'
      num.style.top = stick ? '80px' : ''
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [sectionRef, numberRef])
}
