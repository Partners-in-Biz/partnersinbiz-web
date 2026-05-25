// app/embed/newsletter/[sourceId]/page.tsx
//
// Full-page form rendering of the newsletter widget. Designed to be loaded
// inside an <iframe> on any client site. The /embed layout supplies a
// transparent body so the host site's background shows through.
//
// Display modes inside the iframe:
//   inline      — render the form normally
//   multi-step  — render the multi-step form (progressive endpoint)
//   popup / slide-in / exit-intent — those modes only make sense on the host
//     page (they depend on the visitor's viewport, scroll, and mouse). Inside
//     an iframe they fall back to inline rendering with a small note.

import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import {
  LEAD_CAPTURE_SOURCES,
  type CaptureSource,
  type WidgetDisplayConfig,
} from '@/lib/lead-capture/types'
import { LeadCaptureEmbedForm } from '@/components/lead-capture/LeadCaptureEmbedForm'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ sourceId: string }> }

const OVERLAY_MODES = new Set(['popup', 'slide-in', 'exit-intent'])

function turnstileConfigured(source: CaptureSource): boolean {
  return (
    source.turnstileEnabled === true &&
    typeof source.turnstileSiteKey === 'string' &&
    source.turnstileSiteKey.trim().length > 0 &&
    Boolean(process.env.TURNSTILE_SECRET_KEY)
  )
}

export default async function NewsletterEmbedPage({ params }: Props) {
  const { sourceId } = await params
  const snap = await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(sourceId).get()
  if (!snap.exists || snap.data()?.deleted) notFound()
  const source = { id: snap.id, ...snap.data() } as CaptureSource

  if (!source.active) {
    return (
      <div style={{ padding: 24, color: '#475569', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif' }}>
        This signup form is not active.
      </div>
    )
  }

  const fields = source.fields ?? []
  const submitUrl = `/api/embed/newsletter/${encodeURIComponent(source.id)}/submit`
  const progressiveUrl = `/api/v1/capture-sources/${encodeURIComponent(source.id)}/progressive`

  const rawDisplay = source.display
  const isOverlayMode = !!rawDisplay && OVERLAY_MODES.has(rawDisplay.mode)
  // When loaded inside the iframe and the operator configured an overlay
  // mode, render inline (since the iframe IS the embed surface).
  const display: WidgetDisplayConfig | undefined = rawDisplay
    ? isOverlayMode
      ? { ...rawDisplay, mode: 'inline' }
      : rawDisplay
    : undefined

  return (
    <div style={{ padding: 16, background: 'transparent', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif' }}>
      {isOverlayMode ? (
        <p
          style={{
            margin: '0 auto 12px',
            maxWidth: 460,
            fontSize: 12,
            color: '#94a3b8',
            textAlign: 'center',
          }}
        >
          Showing inline preview — overlay modes (popup, slide-in, exit-intent)
          render on the host page via the script-tag embed.
        </p>
      ) : null}
      <LeadCaptureEmbedForm
        sourceId={source.id}
        theme={source.widgetTheme}
        fields={fields}
        successMessage={source.successMessage}
        successRedirectUrl={source.successRedirectUrl ?? ''}
        submitUrl={submitUrl}
        progressiveUrl={progressiveUrl}
        display={display}
        turnstileSiteKey={turnstileConfigured(source) ? source.turnstileSiteKey : undefined}
      />
    </div>
  )
}
