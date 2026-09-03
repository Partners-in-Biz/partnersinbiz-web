'use client'

import { useRef } from 'react'
import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'
import { useStickyNumber } from '../motion/useStickyNumber'

type Phase = { label: string; duration: string; description?: string }

function TimelinePhase({ phase, index }: { phase: Phase; index: number }) {
  const sectionRef = useRef<HTMLLIElement>(null)
  const numberRef = useRef<HTMLSpanElement>(null)
  useStickyNumber(sectionRef, numberRef)
  return (
    <li ref={sectionRef} className="relative">
      <span
        ref={numberRef}
        className="absolute -left-[2.6rem] flex h-12 w-12 items-center justify-center rounded-md text-sm font-medium"
        style={{ background: 'var(--doc-accent)', color: 'var(--doc-bg)' }}
      >
        {String(index + 1).padStart(2, '0')}
      </span>
      <h3 className="text-lg font-medium text-[var(--doc-text)] md:text-xl">
        {phase.label}
      </h3>
      <p className="mt-1 text-xs uppercase tracking-wider text-[var(--doc-muted)]">
        {phase.duration}
      </p>
      {phase.description && (
        <p className="mt-3 max-w-prose text-sm leading-6 text-[var(--doc-text)] opacity-80 md:text-base">
          {phase.description}
        </p>
      )}
    </li>
  )
}

export function TimelineBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const phases: Phase[] = ((block.content as { phases?: Phase[] } | null)?.phases) ?? []
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-8 text-2xl font-medium text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <ol
        className="relative space-y-10 border-l-2 pl-8"
        style={{ borderColor: 'var(--doc-border)' }}
      >
        {phases.map((phase, i) => (
          <TimelinePhase key={i} phase={phase} index={i} />
        ))}
      </ol>
    </BlockFrame>
  )
}
