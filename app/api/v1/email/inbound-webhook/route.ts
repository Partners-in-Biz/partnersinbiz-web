/**
 * POST /api/v1/email/inbound-webhook — Resend Inbound (Routes) receiver
 *
 * Public endpoint — no auth middleware.
 *
 * Security model:
 *   - If RESEND_WEBHOOK_SECRET is set (whsec_…) we verify the svix signature
 *     exactly like /api/v1/email/webhook does. Resend's outbound + inbound
 *     webhooks share the signing infrastructure.
 *   - If unset, the route accepts unsigned requests but warns once at cold
 *     start. Use only in dev / preview environments.
 *   - Shared helper note: inbound and outbound Resend webhook routes currently
 *     perform the same local Svix verification flow. If lib/security/svix.ts
 *     lands later, centralise both routes there without changing behaviour.
 *
 * Payload shape (best-effort — Resend's inbound payload is still evolving;
 * we read defensively):
 *   {
 *     type: 'email.inbound' | 'inbound.email' | ...
 *     data: {
 *       from?: string | { email: string; name?: string },
 *       to?: string[] | string,
 *       subject?: string,
 *       text?: string,
 *       html?: string,
 *       headers?: Record<string, string> | Array<{ name: string; value: string }>,
 *       in_reply_to?: string,
 *       references?: string[] | string,
 *       attachments?: Array<{ filename?: string; content_type?: string; size?: number; url?: string }>,
 *       message_id?: string,
 *       email_id?: string,
 *     }
 *   }
 *
 * We accept the message at face value, classify it, write the inbound doc,
 * and run the routing pipeline. Failures past the write are returned to the
 * caller but the inbound doc still lives in Firestore.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { classifyReply } from '@/lib/email/inbound/classify'
import { processInboundEmail, newInboundEmail } from '@/lib/email/inbound/route'

export const dynamic = 'force-dynamic'

let missingSecretWarned = false

interface RawPayload {
  type?: string
  data?: Record<string, unknown>
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).filter(Boolean)
  if (typeof v === 'string') {
    // RFC 2822 References is a whitespace-separated list of Message-IDs.
    return v.split(/\s+/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function normaliseHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === 'object') {
        const e = entry as { name?: string; value?: string }
        if (e.name) out[e.name] = asString(e.value)
      }
    }
    return out
  }
  if (typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = asString(v)
    }
  }
  return out
}

function parseFrom(raw: unknown): { email: string; name: string } {
  if (!raw) return { email: '', name: '' }
  if (typeof raw === 'string') {
    // Try "Name <email@x>" form.
    const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
    if (m) return { name: m[1].trim(), email: m[2].trim() }
    return { email: raw.trim(), name: '' }
  }
  if (typeof raw === 'object') {
    const o = raw as { email?: string; name?: string; address?: string }
    return { email: asString(o.email ?? o.address), name: asString(o.name) }
  }
  return { email: '', name: '' }
}

function parseTo(raw: unknown): string {
  if (Array.isArray(raw) && raw.length > 0) return parseFrom(raw[0]).email
  return parseFrom(raw).email
}

function parseAttachments(raw: unknown): Array<{
  name: string
  contentType: string
  sizeBytes: number
  url?: string
}> {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a) => a && typeof a === 'object')
    .map((a) => {
      const x = a as {
        filename?: string
        name?: string
        content_type?: string
        contentType?: string
        size?: number
        sizeBytes?: number
        url?: string
      }
      return {
        name: asString(x.filename ?? x.name),
        contentType: asString(x.content_type ?? x.contentType),
        sizeBytes: typeof x.size === 'number' ? x.size : typeof x.sizeBytes === 'number' ? x.sizeBytes : 0,
        url: x.url ? asString(x.url) : undefined,
      }
    })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text()

  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (secret) {
    const headers = {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }
    try {
      new Webhook(secret).verify(rawBody, headers)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[email/inbound-webhook] signature verification failed', err)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
  } else if (!missingSecretWarned) {
    missingSecretWarned = true
    // eslint-disable-next-line no-console
    console.warn(
      '[email/inbound-webhook] RESEND_WEBHOOK_SECRET is not set — accepting unsigned webhooks. Set this in production.',
    )
  }

  let payload: RawPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Accept either the modern envelope shape or a flat payload (some Resend
  // route presets POST the parsed email directly without a wrapping `data`).
  const data: Record<string, unknown> =
    payload?.data && typeof payload.data === 'object' ? payload.data : (payload as unknown as Record<string, unknown>)

  const from = parseFrom(data.from)
  const toEmail = parseTo(data.to)
  const subject = asString(data.subject)
  const bodyText = asString(data.text ?? data.body_text ?? data.bodyText)
  const bodyHtml = asString(data.html ?? data.body_html ?? data.bodyHtml)
  const rawHeaders = normaliseHeaders(data.headers)
  const inReplyTo = asString(
    data.in_reply_to ??
      data.inReplyTo ??
      rawHeaders['In-Reply-To'] ??
      rawHeaders['in-reply-to'] ??
      '',
  )
  const references = data.references
    ? asStringArray(data.references)
    : asStringArray(rawHeaders['References'] ?? rawHeaders['references'] ?? '')
  const attachments = parseAttachments(data.attachments)

  const intent = classifyReply({
    subject,
    bodyText,
    fromEmail: from.email,
    rawHeaders,
  })

  const inboundData = newInboundEmail({
    fromEmail: from.email,
    fromName: from.name,
    toEmail,
    subject,
    bodyText,
    bodyHtml,
    rawHeaders,
    inReplyTo,
    references,
    attachments,
    intent,
  })

  // Persist before routing so we never lose the message even if processing
  // throws partway through.
  const docRef = await adminDb.collection('inbound_emails').add({
    ...inboundData,
    processedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  })

  try {
    const result = await processInboundEmail(docRef.id, {
      ...inboundData,
      id: docRef.id,
      processedAt: null,
      createdAt: null,
    })
    return NextResponse.json({
      ok: true,
      id: docRef.id,
      intent: result.intent,
      processed: true,
      pausedEnrollments: result.pausedEnrollments,
      unsubscribed: result.unsubscribed,
      contactMatched: result.contactMatched,
      outboundMatched: result.outboundMatched,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[email/inbound-webhook] processing failed', err)
    return NextResponse.json(
      {
        ok: false,
        id: docRef.id,
        intent,
        processed: false,
        error: (err as Error)?.message ?? 'Processing failed',
      },
      { status: 500 },
    )
  }
}
