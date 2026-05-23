import React from 'react'
import type { PreviewBrand, PreviewMedia } from './types'

export function getFirstImage(media?: PreviewMedia[]): { url: string; alt?: string } | null {
  if (!media) return null
  for (const m of media) {
    if (m.type === 'image' && m.url) return { url: m.url, alt: m.alt }
  }
  return null
}

export function getFirstVideo(
  media?: PreviewMedia[]
): { url: string; thumbnailUrl?: string; durationSec?: number; urlYoutube?: string; urlStories?: string } | null {
  if (!media) return null
  for (const m of media) {
    if (m.type === 'video' && m.url) {
      return {
        url: m.url,
        thumbnailUrl: m.thumbnailUrl,
        durationSec: m.durationSec,
        urlYoutube: m.urlYoutube,
        urlStories: m.urlStories,
      }
    }
  }
  return null
}

export function formatDuration(sec?: number): string {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function compactCount(n?: number): string {
  if (!n || n <= 0) return '0'
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function brandFont(brand: PreviewBrand | undefined, kind: 'heading' | 'body'): string | undefined {
  return brand?.typography?.[kind]
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(normalized)) {
    return normalized.split('').map((c) => parseInt(`${c}${c}`, 16)) as [number, number, number]
  }
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null
  return [0, 2, 4].map((i) => parseInt(normalized.slice(i, i + 2), 16)) as [number, number, number]
}

function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground)
  const bg = relativeLuminance(background)
  if (fg === null || bg === null) return 0
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
}

export function readableAccentOnDark(accent?: string, fallback = '#8BD8BD'): string {
  if (!accent) return fallback
  return contrastRatio(accent, '#000000') >= 4.5 ? accent : fallback
}

/** Lightweight image with placeholder fallback. */
export function PreviewImage({
  src,
  alt,
  className,
  style,
}: {
  src?: string | null
  alt?: string
  className?: string
  style?: React.CSSProperties
}) {
  if (!src) {
    return (
      <div
        className={className}
        style={{
          background: 'linear-gradient(135deg, #2a2a2e 0%, #1a1a1e 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#555',
          fontSize: 11,
          letterSpacing: 0.5,
          ...style,
        }}
      >
        NO IMAGE
      </div>
    )
  }
  // Plain <img> on purpose — avoids next.config remotePatterns headaches for arbitrary urls.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt || ''} className={className} style={{ objectFit: 'cover', ...style }} />
}

/**
 * Extract the text body from a post.content field, which on the platform can
 * be either a plain string OR the wrapped object shape used by social_posts:
 * `{ text, platformOverrides }`. Used by every card so they render either way.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPostText(content: any): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text
  }
  return ''
}

/** Render hashtags into post body if not already inline. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withHashtags(content: any, hashtags?: string[]): string {
  const safe = getPostText(content)
  if (!hashtags || hashtags.length === 0) return safe
  const present = hashtags.filter((tag) => !safe.includes(`#${tag.replace(/^#/, '')}`))
  if (present.length === 0) return safe
  const formatted = present.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')
  return safe ? `${safe}\n\n${formatted}` : formatted
}

/** Highlight #hashtags and @mentions in a body of text. */
export function HighlightedText({
  text,
  linkColor = '#4493F8',
}: {
  text: string
  linkColor?: string
}) {
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((p, i) => {
        if (/^#[\w-]+$/.test(p) || /^@[\w.-]+$/.test(p)) {
          return (
            <span key={i} style={{ color: linkColor }}>
              {p}
            </span>
          )
        }
        // preserve newlines
        if (p.includes('\n')) {
          const lines = p.split('\n')
          return (
            <React.Fragment key={i}>
              {lines.map((line, j) => (
                <React.Fragment key={j}>
                  {j > 0 && <br />}
                  {line}
                </React.Fragment>
              ))}
            </React.Fragment>
          )
        }
        return <React.Fragment key={i}>{p}</React.Fragment>
      })}
    </>
  )
}

export function relativeTime(iso?: string): string {
  if (!iso) return 'now'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return 'now'
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return `${Math.max(1, Math.floor(diff))}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400 / 7)}w`
  return `${Math.floor(diff / 86400 / 30)}mo`
}
