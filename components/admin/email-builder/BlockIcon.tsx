'use client'

import type { BlockType } from '@/lib/email-builder/types'

const ICONS: Record<BlockType, string> = {
  hero: 'H',
  heading: 'T',
  paragraph: '¶',
  button: '◉',
  image: '▣',
  divider: '─',
  spacer: '↕',
  columns: '◫',
  footer: '⌐',
  'amp-carousel': '⇄',
  'amp-accordion': '≡',
  'amp-form': '⌨',
  'amp-live-data': '⏱',
}

const LABELS: Record<BlockType, string> = {
  hero: 'Hero',
  heading: 'Heading',
  paragraph: 'Paragraph',
  button: 'Button',
  image: 'Image',
  divider: 'Divider',
  spacer: 'Spacer',
  columns: 'Columns',
  footer: 'Footer',
  'amp-carousel': 'Carousel (AMP)',
  'amp-accordion': 'Accordion (AMP)',
  'amp-form': 'Inline form (AMP)',
  'amp-live-data': 'Live data (AMP)',
}

export function BlockIcon({ type, className = '' }: { type: BlockType; className?: string }) {
  return (
    <span
      className={`  !w-7 !h-7 text-sm font-medium ${className}`}
      aria-hidden="true"
    >
      {ICONS[type]}
    </span>
  )
}

export function blockLabel(type: BlockType): string {
  return LABELS[type]
}
