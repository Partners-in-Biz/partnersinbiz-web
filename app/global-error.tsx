'use client'

/**
 * Replaces the root layout when it fails, so Studio tokens and CSS are unavailable.
 * Inline paper tokens so the page stays readable without any stylesheet.
 */
const canvas = '#f3efe6'
const ink = '#1a1714'
const inkSoft = '#4e4841'
const accent = '#e4572e'
const font = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
const fontMono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: canvas,
          color: ink,
          fontFamily: font,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <main style={{ maxWidth: '36rem', width: '100%' }}>
          <p
            style={{
              margin: 0,
              fontFamily: fontMono,
              fontSize: '0.6875rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: inkSoft,
            }}
          >
            Error
          </p>
          <h1
            style={{
              margin: '1rem 0 0',
              fontSize: '1.75rem',
              fontWeight: 500,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            Something went wrong.
          </h1>
          <p style={{ margin: '1rem 0 0', color: inkSoft, fontSize: '1rem', lineHeight: 1.5 }}>
            The page failed to load. Try again, or return home if the problem continues.
          </p>
          {process.env.NODE_ENV === 'development' ? (
            <pre
              style={{
                margin: '1rem 0 0',
                fontSize: '0.8rem',
                color: inkSoft,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {error.message}
            </pre>
          ) : null}
          <div style={{ marginTop: '2rem' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: ink,
                font: 'inherit',
                fontSize: '0.9375rem',
                fontWeight: 500,
                cursor: 'pointer',
                textDecoration: 'underline',
                textDecorationColor: accent,
                textUnderlineOffset: '0.2em',
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
