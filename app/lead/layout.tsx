// app/lead/layout.tsx
//
// Minimal HTML layout for the public /lead/* pages (e.g. DOI confirmation).
// Overrides the marketing root layout so we get a clean paper screen with
// no agency-site navigation.

import type { Metadata } from 'next'
import '../globals.css'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function LeadLayout({ children }: { children: React.ReactNode }) {
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
