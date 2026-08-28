// lib/email/providers/ses.ts
//
// Amazon SES v2 adapter. Sends via the SESv2 SendEmail API using a Raw MIME
// payload so we can attach List-Unsubscribe and other arbitrary headers (the
// Simple shape does not support custom headers).
//
// Bounces, complaints, opens and clicks are NOT delivered inline — SES emits
// them via an SNS topic attached to the configured ConfigurationSet. Wire that
// SNS topic to /api/v1/email/webhook/ses (see route for SNS subscription
// confirmation handling).
//
// Required env:
//   AWS_REGION                e.g. us-east-1
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//   SES_CONFIGURATION_SET     optional — needed for open/click/bounce events

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { encodeMimeHeaderValue } from '@/lib/email/rfc2047'
import {
  buildSendHeaders,
  type EmailProvider,
  type EmailProviderSendInput,
  type EmailProviderSendResult,
} from '../provider'

let client: SESv2Client | null = null

function getClient(): SESv2Client {
  if (!client) {
    const region = process.env.AWS_REGION?.trim() || 'us-east-1'
    client = new SESv2Client({ region })
  }
  return client
}

export function resetSesClientForTests(): void {
  client = null
}

/** RFC 2047 for raw MIME headers. SES rejects bare non-ASCII bytes. */
function encodeHeaderValue(value: string): string {
  return encodeMimeHeaderValue(value)
}

/**
 * Builds a multipart/alternative MIME message with the supplied headers, HTML
 * body, and text body. Keeps the formatting simple — we don't need
 * attachments, only headers + the two bodies.
 */
function buildRawMime(args: {
  from: string
  to: string | string[]
  cc: string[] | undefined
  replyTo: string | undefined
  subject: string
  html: string
  text: string
  headers: Record<string, string>
}): Buffer {
  const boundary = `pib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const lines: string[] = []

  lines.push(`From: ${args.from}`)
  lines.push(`To: ${Array.isArray(args.to) ? args.to.join(', ') : args.to}`)
  if (args.cc && args.cc.length > 0) lines.push(`Cc: ${args.cc.join(', ')}`)
  if (args.replyTo) lines.push(`Reply-To: ${args.replyTo}`)
  lines.push(`Subject: ${encodeHeaderValue(args.subject)}`)
  lines.push('MIME-Version: 1.0')
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)

  for (const [k, v] of Object.entries(args.headers)) {
    // Skip headers SES manages itself or that conflict with the MIME shape.
    const lower = k.toLowerCase()
    if (lower === 'mime-version' || lower === 'content-type' || lower === 'from' || lower === 'to' || lower === 'cc' || lower === 'subject') continue
    lines.push(`${k}: ${encodeHeaderValue(v)}`)
  }

  lines.push('')
  lines.push(`--${boundary}`)
  lines.push('Content-Type: text/plain; charset=UTF-8')
  lines.push('Content-Transfer-Encoding: 8bit')
  lines.push('')
  lines.push(args.text)
  lines.push('')
  lines.push(`--${boundary}`)
  lines.push('Content-Type: text/html; charset=UTF-8')
  lines.push('Content-Transfer-Encoding: 8bit')
  lines.push('')
  lines.push(args.html)
  lines.push('')
  lines.push(`--${boundary}--`)

  return Buffer.from(lines.join('\r\n'), 'utf-8')
}

export function createSesProvider(): EmailProvider {
  return {
    id: 'ses',

    isConfigured(): boolean {
      return !!(
        process.env.AWS_ACCESS_KEY_ID?.trim() &&
        process.env.AWS_SECRET_ACCESS_KEY?.trim() &&
        (process.env.AWS_REGION?.trim() || true)
      )
    },

    async send(input: EmailProviderSendInput): Promise<EmailProviderSendResult> {
      const headers = buildSendHeaders(input)
      const raw = buildRawMime({
        from: input.from,
        to: input.to,
        cc: input.cc,
        replyTo: input.replyTo,
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers,
      })

      const configurationSetName = process.env.SES_CONFIGURATION_SET?.trim() || undefined

      try {
        const result = await getClient().send(
          new SendEmailCommand({
            Content: { Raw: { Data: raw } },
            ConfigurationSetName: configurationSetName,
          }),
        )
        const messageId = result.MessageId?.trim() ?? ''
        if (!messageId) {
          return { ok: false, messageId: '', provider: 'ses', error: 'SES returned no MessageId' }
        }
        return { ok: true, messageId, provider: 'ses' }
      } catch (err) {
        return {
          ok: false,
          messageId: '',
          provider: 'ses',
          error: err instanceof Error ? err.message : 'SES send failed',
        }
      }
    },
  }
}
