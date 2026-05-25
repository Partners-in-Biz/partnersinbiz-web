import {
  isResendWebhookSignatureRequired,
  verifyResendWebhookSignature,
} from '@/lib/email/resendWebhook'

describe('Resend webhook signature guard', () => {
  const headers = { 'svix-id': '', 'svix-timestamp': '', 'svix-signature': '' }

  it('allows unsigned webhooks outside production with an explicit warning', () => {
    const result = verifyResendWebhookSignature({
      rawBody: '{}',
      headers,
      routeLabel: 'email/webhook',
      env: { VERCEL_ENV: 'preview' } as NodeJS.ProcessEnv,
    })

    expect(result.ok).toBe(true)
    expect(result.warning).toContain('RESEND_WEBHOOK_SECRET is not set')
  })

  it('fails closed when production is missing RESEND_WEBHOOK_SECRET', () => {
    const result = verifyResendWebhookSignature({
      rawBody: '{}',
      headers,
      routeLabel: 'email/inbound-webhook',
      env: { VERCEL_ENV: 'production' } as NodeJS.ProcessEnv,
    })

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: 'Webhook signature secret is not configured',
    })
  })

  it('treats NODE_ENV production without VERCEL_ENV as strict by default', () => {
    expect(
      isResendWebhookSignatureRequired({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toBe(true)
  })

  it('lets an explicit require flag enforce signatures in preview/dev', () => {
    expect(
      isResendWebhookSignatureRequired({
        VERCEL_ENV: 'preview',
        RESEND_WEBHOOK_REQUIRE_SIGNATURE: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true)
  })

  it('rejects invalid Svix signatures when a secret is configured', () => {
    const result = verifyResendWebhookSignature({
      rawBody: '{}',
      headers,
      routeLabel: 'email/webhook',
      env: { RESEND_WEBHOOK_SECRET: 'whsec_test_secret' } as NodeJS.ProcessEnv,
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toBe('Invalid signature')
  })
})
