// lib/email/send.ts
//
// Tiny convenience wrapper for simple transactional sends (system
// notifications, signup confirmations, etc.). Routes through the configured
// provider — same backend as `sendCampaignEmail`. New code should prefer
// `sendCampaignEmail` for anything campaign-shaped.

import { getEmailProvider } from './provider'
import { htmlToPlainText } from './resend'
import { assertOutboundEmailAllowed } from './policy'

interface EmailOptions {
  to: string
  subject: string
  html: string
  from?: string
}

const DEFAULT_FROM = 'Partners in Biz <notifications@partnersinbiz.online>'

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  const provider = getEmailProvider()
  const policy = await assertOutboundEmailAllowed({ recipients: [options.to] })
  if (!policy.allowed) {
    return { success: false, error: policy.error }
  }
  if (!provider.isConfigured()) {
    console.warn(`[Email] ${provider.id} provider not configured, skipping email`)
    return { success: false, error: 'Email not configured' }
  }

  const result = await provider.send({
    from: options.from ?? DEFAULT_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: htmlToPlainText(options.html),
  })

  if (!result.ok) {
    console.error('[Email] Send failed:', result.error)
    return { success: false, error: result.error }
  }
  return { success: true }
}
