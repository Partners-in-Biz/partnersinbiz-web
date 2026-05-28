import { getEmailProvider } from '@/lib/email/provider'
import { sendEmail } from '@/lib/email/send'
import type { CommunicationProvider, ProviderReadiness, ProviderSendInput, ProviderSendResult } from './types'

export const emailCommunicationProvider: CommunicationProvider = {
  id: 'resend',
  name: 'PiB email provider',
  supports: ['email'],
  getReadiness(): ProviderReadiness {
    const provider = getEmailProvider()
    const configured = provider.isConfigured()
    return {
      configured,
      healthy: configured,
      missing: configured ? [] : ['email provider environment variables'],
      checks: [
        {
          id: 'email-provider',
          label: `${provider.id} provider`,
          status: configured ? 'pass' : 'fail',
          detail: configured ? 'Email provider is configured.' : 'Configure the selected PiB email provider.',
        },
      ],
    }
  },
  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    if (input.channel !== 'email') {
      return { ok: false, status: 'unsupported', error: `Email provider does not support ${input.channel}` }
    }
    const result = await sendEmail({
      to: input.to,
      subject: input.subject ?? 'Message from Partners in Biz',
      html: input.html ?? input.body,
      from: input.from,
    })
    return {
      ok: result.success,
      status: result.success ? 'sent' : 'failed',
      error: result.error,
    }
  },
}
