import type { CSSProperties, ReactNode } from 'react'
import type { DocumentTheme as DocumentThemeType } from '@/lib/client-documents/types'

const DARK_DEFAULTS = {
  bg: 'var(--sc-ink)',
  text: '#F7F4EE',
  accent: 'var(--sc-accent)',
  muted: '#888888',
  border: '#222222',
  surface: '#141416',
} as const

const LIGHT_DEFAULTS = {
  muted: '#6B7280',
  border: '#E5E7EB',
  surface: '#F3F4F6',
} as const

function pick(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback
}

/** Relative luminance for `#RRGGBB`. Returns null for non-hex colors. */
function hexLuminance(color: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  const int = Number.parseInt(m[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function isLightBackground(bg: string): boolean {
  const lum = hexLuminance(bg)
  return lum !== null && lum >= 0.45
}

/** Add a `#RRGGBB` alpha suffix. Falls back to original if non-hex. */
function withAlpha(color: string, alpha01: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const a = Math.round(alpha01 * 255).toString(16).padStart(2, '0')
  return `#${m[1]}${a}`.toLowerCase()
}

export function DocumentTheme({
  palette,
  children,
  className,
}: {
  palette?: DocumentThemeType['palette']
  children: ReactNode
  className?: string
}) {
  const bg = pick(palette?.bg, DARK_DEFAULTS.bg)
  const text = pick(palette?.text, DARK_DEFAULTS.text)
  const accent = pick(palette?.accent, DARK_DEFAULTS.accent)
  const light = isLightBackground(bg)
  const muted = pick(palette?.muted, light ? LIGHT_DEFAULTS.muted : DARK_DEFAULTS.muted)
  const border = pick(palette?.border, light ? LIGHT_DEFAULTS.border : DARK_DEFAULTS.border)
  const surface = pick(palette?.surface, light ? LIGHT_DEFAULTS.surface : DARK_DEFAULTS.surface)

  const style: CSSProperties = {
    '--doc-bg': bg,
    '--doc-text': text,
    '--doc-accent': accent,
    '--doc-accent-soft': withAlpha(accent, 0.15),
    '--doc-accent-strong': accent,
    '--doc-muted': muted,
    '--doc-border': border,
    '--doc-surface': surface,
    background: bg,
    color: text,
  } as CSSProperties

  return (
    <div className={className} style={style}>
      {children}
    </div>
  )
}
