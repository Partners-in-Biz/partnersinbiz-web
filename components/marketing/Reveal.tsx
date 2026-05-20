'use client'

import { useEffect, useRef, useState, ReactNode } from 'react'

interface Props {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'section' | 'article' | 'li' | 'span'
  eager?: boolean
}

export function Reveal({ children, delay = 0, className = '', as: Tag = 'div', eager = false }: Props) {
  const ref = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(eager)

  useEffect(() => {
    if (eager) return
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true)
            obs.unobserve(e.target)
          }
        }
      },
      { rootMargin: '-60px', threshold: 0.05 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [eager])

  return (
    <Tag
      ref={ref as never}
      style={{
        transitionDelay: `${delay}ms`,
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(16px)',
        transition: 'opacity 700ms cubic-bezier(0.22, 1, 0.36, 1), transform 700ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className={className}
    >
      {children}
    </Tag>
  )
}
