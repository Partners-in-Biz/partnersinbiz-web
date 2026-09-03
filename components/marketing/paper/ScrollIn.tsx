'use client'

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import './paper-motion.css'

type Tag = 'div' | 'section' | 'span' | 'li'

/**
 * Marks its children for the paper scroll-in motion (see paper-motion.css).
 * Server HTML ships without the data attribute so it is always visible; the
 * `pending` state is only ever applied client-side, after the bounding rect
 * confirms the element sits below the fold.
 */
export function ScrollIn({
  children,
  as = 'div',
  className,
}: {
  children: ReactNode
  as?: Tag
  className?: string
}) {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reveal = () => el.setAttribute('data-sc-in', 'in')

    if (typeof IntersectionObserver === 'undefined') {
      reveal()
      return
    }
    if (el.getBoundingClientRect().top < window.innerHeight) {
      reveal()
      return
    }

    // Attribute and observer land in the same tick so nothing paints hidden
    // without an observer already waiting to reveal it.
    el.setAttribute('data-sc-in', 'pending')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal()
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Typed as a div so the polymorphic tag accepts the shared ref.
  const Tag = as as 'div'
  return (
    <Tag ref={ref as RefObject<HTMLDivElement>} className={className ? `sc-in ${className}` : 'sc-in'}>
      {children}
    </Tag>
  )
}
