'use client'

import { useEffect, useRef, useState, ReactNode } from 'react'

interface Props {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'section' | 'article' | 'li' | 'span'
  eager?: boolean
}

/**
 * Fades content in as it scrolls into view. Renders visible by default so
 * server HTML, above-the-fold content, and environments without an
 * IntersectionObserver never sit at opacity 0. Only content that is below the
 * fold when it mounts gets hidden and then animated in.
 */
export function Reveal({ children, delay = 0, className = '', as: Tag = 'div', eager = false }: Props) {
  const ref = useRef<HTMLElement | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (eager) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const rect = el.getBoundingClientRect()
    const belowFold = rect.top > window.innerHeight
    if (!belowFold) return

    setHidden(true)
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setHidden(false)
            obs.unobserve(e.target)
          }
        }
      },
      { rootMargin: '-40px', threshold: 0.05 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [eager])

  return (
    <Tag
      ref={ref as never}
      style={{
        transitionDelay: `${delay}ms`,
        opacity: hidden ? 0 : 1,
        transform: hidden ? 'translateY(16px)' : 'translateY(0)',
        transition: 'opacity 700ms cubic-bezier(0.22, 1, 0.36, 1), transform 700ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className={className}
    >
      {children}
    </Tag>
  )
}
