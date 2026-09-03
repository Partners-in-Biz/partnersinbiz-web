// app/embed/layout.tsx
//
// Minimal layout for embed surfaces (iframes / widgets). Replaces the
// marketing root layout so the host site's chrome doesn't bleed into
// embedded content.

import type { Metadata } from 'next'
import '../globals.css'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>
        <div className="sc-stage sc-paper sc-stage--flat">
          {children}
        </div>
      </body>
    </html>
  )
}
