// lib/email/resend.ts
//
// Campaign / sequence send entrypoint. Historically called Resend directly;
// now delegates to whatever provider `getEmailProvider()` resolves to
// (Resend or SES, switched by EMAIL_PROVIDER). The exported types preserve
// the `resendId` field name for back-compat with existing callers — it now
// holds the provider's message ID regardless of which provider sent the mail.
//
// Domain administration (resend.domains.*) still uses the Resend SDK directly
// — see app/api/v1/email/domains/route.ts. That path is Resend-specific and
// not abstracted here.

import { Resend } from 'resend'
import { getEmailProvider } from './provider'
import { assertOutboundEmailAllowed } from './policy'

// FROM_ADDRESS is reserved for SYSTEM emails (ops notifications, approvals,
// invoice mails sent on behalf of PIB itself). Campaign / sequence sends
// must go through `sendCampaignEmail` so they pick the right per-org sender.
export const FROM_ADDRESS = 'peet@partnersinbiz.online'

let client: Resend | null = null

/**
 * Returns a singleton Resend client. Lazy-initialised so it is safe at build
 * time. Used by Resend-specific admin endpoints (domain verification,
 * audience management); send paths should use `sendCampaignEmail` so they
 * benefit from the provider abstraction.
 */
export function getResendClient(): Resend {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY)
  }
  return client
}

export interface CampaignSendInput {
  from: string                  // pre-formatted; resolve via lib/email/resolveFrom
  to: string | string[]         // single recipient for campaigns; array allowed for system/digest mails
  cc?: string[]
  replyTo?: string
  subject: string
  html: string
  text: string
  /**
   * Extra SMTP headers. Merged with any auto-added List-Unsubscribe headers
   * (see `listUnsubscribeUrl`). Caller-supplied keys win on conflict.
   */
  headers?: Record<string, string>
  /**
   * If set, the send adds:
   *   List-Unsubscribe:        <{url}>
   *   List-Unsubscribe-Post:   List-Unsubscribe=One-Click
   * which is required by Gmail/Yahoo bulk-sender rules (RFC 8058).
   */
  listUnsubscribeUrl?: string
}

export interface CampaignSendResult {
  ok: boolean
  /** Provider-issued message ID. Empty when ok=false. Field name kept for back-compat. */
  resendId: string
  /** Which provider handled the send. */
  provider: 'resend' | 'ses'
  error?: string
}

/**
 * Sends a campaign / sequence email through the configured provider. Caller
 * is responsible for resolving the sender (see lib/email/resolveFrom) and for
 * interpolating any template variables before passing html/text in.
 */
export async function sendCampaignEmail(input: CampaignSendInput): Promise<CampaignSendResult> {
  const provider = getEmailProvider()
  const recipients = Array.isArray(input.to) ? input.to : [input.to]
  const policy = await assertOutboundEmailAllowed({ recipients })
  if (!policy.allowed) {
    return {
      ok: false,
      resendId: '',
      provider: provider.id,
      error: policy.error,
    }
  }
  const result = await provider.send({
    from: input.from,
    to: input.to,
    cc: input.cc,
    replyTo: input.replyTo,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: input.headers,
    listUnsubscribeUrl: input.listUnsubscribeUrl,
  })
  return {
    ok: result.ok,
    resendId: result.messageId,
    provider: result.provider,
    error: result.error,
  }
}

/**
 * Wraps plain-text body lines in simple HTML paragraphs.
 * Used when bodyHtml is not explicitly provided by the caller.
 */
export function plainTextToHtml(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => `<p style="margin:0 0 8px">${l}</p>`)
    .join('')
  return `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111;">${lines}</div>`
}

/**
 * Strips HTML tags to produce a plain-text fallback from bodyHtml.
 */
export function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}
