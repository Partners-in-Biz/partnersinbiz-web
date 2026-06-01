'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Fade-and-slide reveal motion for any descendant element marked with
 * `data-motion="reveal"` inside the given root. Elements start hidden
 * (opacity 0, translated down 24px) and animate in once they enter the
 * viewport. Re-runs whenever `dependencyKey` changes (typically the
 * document version id).
 */
export function useReveal(rootRef: RefObject<HTMLElement | null>, dependencyKey: unknown) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const els = root.querySelectorAll('[data-motion="reveal"]') as NodeListOf<HTMLElement>
    if (els.length === 0) return

    function reveal(el: HTMLElement) {
      el.style.opacity = '1'
      el.style.transform = 'translateY(0)'
      el.style.transition = 'opacity 0.55s ease, transform 0.55s ease'
    }

    els.forEach((el) => {
      el.style.opacity = '0'
      el.style.transform = 'translateY(24px)'
    })

    if (typeof IntersectionObserver === 'undefined') {
      els.forEach(reveal)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement
            reveal(el)
            observer.unobserve(el)
          }
        })
      },
      // Reveal as soon as any part of a section enters the viewport. Using a
      // fractional threshold against the whole section can leave tall blocks
      // permanently hidden because 15% of the block may never fit onscreen.
      { rootMargin: '0px 0px -10% 0px', threshold: 0 },
    )

    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [rootRef, dependencyKey])
}
