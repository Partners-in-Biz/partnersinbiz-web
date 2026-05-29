import twilio from 'twilio'
import { sendSms } from '@/lib/sms/twilio'
import type { CommunicationProvider, ProviderReadiness, ProviderSendInput, ProviderSendResult } from './types'

function envValue(env: Record<string, string | undefined>, key: string): string {
  return (env[key] ?? '').trim()
}

export const twilioCommunicationProvider: CommunicationProvider = {
  id: 'twilio',
  name: 'Twilio WhatsApp and SMS',
  supports: ['whatsapp', 'sms'],
  getReadiness(env = process.env): ProviderReadiness {
    const accountSid = envValue(env, 'TWILIO_ACCOUNT_SID')
    const authToken = envValue(env, 'TWILIO_AUTH_TOKEN')
    const messagingServiceSid = envValue(env, 'TWILIO_MESSAGING_SERVICE_SID')
    const defaultFrom = envValue(env, 'TWILIO_DEFAULT_FROM_NUMBER')
    const whatsappFrom = envValue(env, 'TWILIO_WHATSAPP_FROM')
    const missing: string[] = []
    if (!accountSid) missing.push('TWILIO_ACCOUNT_SID')
    if (!authToken) missing.push('TWILIO_AUTH_TOKEN')
    if (!messagingServiceSid && !defaultFrom) missing.push('TWILIO_MESSAGING_SERVICE_SID or TWILIO_DEFAULT_FROM_NUMBER')

    return {
      configured: missing.length === 0,
      healthy: missing.length === 0,
      missing,
      checks: [
        {
          id: 'twilio-credentials',
          label: 'Twilio credentials',
          status: accountSid && authToken ? 'pass' : 'fail',
          detail: accountSid && authToken ? 'Account SID and auth token are configured.' : 'Add Twilio credentials before sending.',
        },
        {
          id: 'sms-sender',
          label: 'SMS sender',
          status: messagingServiceSid || defaultFrom ? 'pass' : 'fail',
          detail: messagingServiceSid
            ? 'Messaging Service SID configured.'
            : defaultFrom
              ? 'Default sender number configured.'
              : 'Configure a Messaging Service or default sender number.',
        },
        {
          id: 'whatsapp-sender',
          label: 'WhatsApp sender',
          status: whatsappFrom ? 'pass' : 'warn',
          detail: whatsappFrom
            ? 'WhatsApp sender configured.'
            : 'Set TWILIO_WHATSAPP_FROM before enabling outbound WhatsApp.',
        },
      ],
    }
  },
  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    if (input.channel === 'sms') {
      const result = await sendSms({
        to: input.to,
        body: input.body,
        from: input.from,
        mediaUrls: input.mediaUrls,
        statusCallbackUrl: input.statusCallbackUrl,
      })
      return {
        ok: result.ok,
        providerMessageId: result.twilioSid,
        status: result.ok ? 'sent' : 'failed',
        error: result.error,
        raw: { errorCode: result.errorCode, segmentsCount: result.segmentsCount },
      }
    }

    if (input.channel !== 'whatsapp') {
      return { ok: false, status: 'unsupported', error: `Twilio does not support ${input.channel}` }
    }

    const accountSid = (process.env.TWILIO_ACCOUNT_SID ?? '').trim()
    const authToken = (process.env.TWILIO_AUTH_TOKEN ?? '').trim()
    const from = (input.from ?? process.env.TWILIO_WHATSAPP_FROM ?? '').trim()
    if (!accountSid || !authToken) {
      return { ok: false, status: 'failed', error: 'Twilio credentials are not configured' }
    }
    if (!from) {
      return { ok: false, status: 'failed', error: 'TWILIO_WHATSAPP_FROM is required for WhatsApp sends' }
    }
    const to = input.to.startsWith('whatsapp:') ? input.to : `whatsapp:${input.to}`
    const sender = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`
    const client = twilio(accountSid, authToken)

    try {
      const message = await client.messages.create({
        from: sender,
        to,
        body: input.body,
        mediaUrl: input.mediaUrls && input.mediaUrls.length > 0 ? input.mediaUrls : undefined,
        statusCallback: input.statusCallbackUrl,
      })
      return {
        ok: true,
        providerMessageId: message.sid,
        status: 'sent',
        raw: { sid: message.sid, status: message.status },
      }
    } catch (error) {
      const err = error as { message?: string; code?: string | number }
      return {
        ok: false,
        status: 'failed',
        error: err.message ?? 'Twilio WhatsApp send failed',
        raw: { code: err.code },
      }
    }
  },
}
