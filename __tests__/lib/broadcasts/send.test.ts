describe('broadcast send pipeline', () => {
  const ORIGINAL_RESEND_API_KEY = process.env.RESEND_API_KEY

  afterEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    if (ORIGINAL_RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = ORIGINAL_RESEND_API_KEY
  })

  it('uses a variant fromName override for the Resend from header and persisted email doc', async () => {
    process.env.RESEND_API_KEY = 're_test'

    const sendCampaignEmail = jest.fn().mockResolvedValue({
      ok: true,
      resendId: 'resend-1',
      provider: 'resend',
    })
    const emailAdd = jest.fn().mockResolvedValue({ id: 'email-1' })
    const broadcastUpdate = jest.fn().mockResolvedValue(undefined)
    const activityAdd = jest.fn().mockResolvedValue({ id: 'activity-1' })
    const variantForStats = {
      id: 'winner',
      name: 'Winner',
      weight: 100,
      overrides: [{ kind: 'fromName', fromName: 'Variant Winner' }],
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      unsubscribed: 0,
    }

    const collection = jest.fn((name: string) => {
      if (name === 'organizations') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Acme Org' }) }),
          })),
        }
      }
      if (name === 'email_domains') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              id: 'domain-1',
              data: () => ({ name: 'client.test', status: 'verified', deleted: false }),
            }),
          })),
        }
      }
      if (name === 'emails') return { add: emailAdd }
      if (name === 'broadcasts') {
        return {
          doc: jest.fn(() => ({
            update: broadcastUpdate,
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({
                ab: { variants: [variantForStats] },
              }),
            }),
          })),
        }
      }
      if (name === 'activities') return { add: activityAdd }
      return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }) })) }
    })

    jest.doMock('@/lib/firebase/admin', () => ({ adminDb: { collection } }))
    jest.doMock('firebase-admin/firestore', () => ({
      FieldValue: {
        serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
        increment: jest.fn((n: number) => ({ __increment: n })),
      },
      Timestamp: { now: jest.fn(() => ({ toMillis: () => Date.now(), toDate: () => new Date() })) },
    }))
    jest.doMock('@/lib/email/resend', () => ({
      sendCampaignEmail,
      htmlToPlainText: (html: string) => html.replace(/<[^>]+>/g, ''),
      plainTextToHtml: (text: string) => `<p>${text}</p>`,
    }))
    jest.doMock('@/lib/email/unsubscribeToken', () => ({ signUnsubscribeToken: jest.fn(() => 'token') }))
    jest.doMock('@/lib/email/suppressions', () => ({ isSuppressed: jest.fn().mockResolvedValue(false) }))
    jest.doMock('@/lib/preferences/store', () => ({
      shouldSendToContact: jest.fn().mockResolvedValue({ allowed: true }),
    }))
    jest.doMock('@/lib/email/frequency', () => ({
      isWithinFrequencyCap: jest.fn().mockResolvedValue({ allowed: true }),
      logFrequencySkip: jest.fn(),
    }))

    const { buildSendContext, sendBroadcastToContactWithVariant } = await import('@/lib/broadcasts/send')

    const broadcast = {
      id: 'broadcast-1',
      orgId: 'org-1',
      fromDomainId: 'domain-1',
      fromLocal: 'news',
      fromName: 'Base Name',
      content: { subject: 'Hello {{firstName}}', bodyText: 'Hi {{firstName}}' },
      stats: {},
    } as any
    const contact = {
      id: 'contact-1',
      orgId: 'org-1',
      email: 'person@example.com',
      name: 'Jane Person',
      firstName: 'Jane',
      tags: [],
    } as any
    const variant = variantForStats as any

    const ctx = await buildSendContext(broadcast)
    const outcome = await sendBroadcastToContactWithVariant(ctx, contact, variant, new Set())

    expect(outcome.status).toBe('sent')
    expect(sendCampaignEmail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Variant Winner <news@client.test>' }),
    )
    expect(emailAdd).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Variant Winner <news@client.test>', variantId: 'winner' }),
    )
  })

  it('uses HTML fallback and records an AMP audit marker when sending AMP templates through Resend', async () => {
    process.env.RESEND_API_KEY = 're_test'

    const sendCampaignEmail = jest.fn().mockResolvedValue({ ok: true, resendId: 'resend-amp-1', provider: 'resend' })
    const emailAdd = jest.fn().mockResolvedValue({ id: 'email-amp-1' })
    const broadcastUpdate = jest.fn().mockResolvedValue(undefined)
    const activityAdd = jest.fn().mockResolvedValue({ id: 'activity-amp-1' })
    const ampTemplateDoc = {
      subject: 'Hi {{firstName}}',
      preheader: 'Latest picks',
      theme: { primaryColor: '#F5A623', textColor: '#0A0A0B', backgroundColor: '#F4F4F5', fontFamily: 'Arial, sans-serif', contentWidth: 600 },
      blocks: [
        { id: 'amp-1', type: 'amp-carousel', props: { slides: [{ imageUrl: 'https://cdn.example.com/home.jpg', alt: 'Home', linkUrl: 'https://example.com/home' }] } },
        { id: 'footer-1', type: 'footer', props: { orgName: '{{orgName}}', address: '1 Market Street', unsubscribeUrl: '{{unsubscribeUrl}}', preferencesUrl: '{{preferencesUrl}}' } },
      ],
    }
    const collection = jest.fn((name: string) => {
      if (name === 'organizations') return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Acme Org' }) }) })) }
      if (name === 'email_templates') return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ document: ampTemplateDoc }) }) })) }
      if (name === 'email_domains') {
        return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: true, id: 'domain-1', data: () => ({ name: 'client.test', status: 'verified', deleted: false }) }) })) }
      }
      if (name === 'emails') return { add: emailAdd }
      if (name === 'broadcasts') return { doc: jest.fn(() => ({ update: broadcastUpdate })) }
      if (name === 'activities') return { add: activityAdd }
      return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }) })) }
    })

    jest.doMock('@/lib/firebase/admin', () => ({ adminDb: { collection } }))
    jest.doMock('firebase-admin/firestore', () => ({
      FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'), increment: jest.fn((n: number) => ({ __increment: n })) },
      Timestamp: { now: jest.fn(() => ({ toMillis: () => Date.now(), toDate: () => new Date() })) },
    }))
    jest.doMock('@/lib/email/resend', () => ({
      sendCampaignEmail,
      htmlToPlainText: (html: string) => html.replace(/<[^>]+>/g, ''),
      plainTextToHtml: (text: string) => `<p>${text}</p>`,
    }))
    jest.doMock('@/lib/email/unsubscribeToken', () => ({ signUnsubscribeToken: jest.fn(() => 'token') }))
    jest.doMock('@/lib/email/suppressions', () => ({ isSuppressed: jest.fn().mockResolvedValue(false) }))
    jest.doMock('@/lib/preferences/store', () => ({ shouldSendToContact: jest.fn().mockResolvedValue({ allowed: true }) }))
    jest.doMock('@/lib/email/frequency', () => ({ isWithinFrequencyCap: jest.fn().mockResolvedValue({ allowed: true }), logFrequencySkip: jest.fn() }))

    const { buildSendContext, sendBroadcastToContact } = await import('@/lib/broadcasts/send')
    const broadcast = { id: 'broadcast-amp-1', orgId: 'org-1', fromDomainId: 'domain-1', fromLocal: 'news', fromName: 'Base Name', content: { templateId: 'template-amp-1', subject: 'Fallback subject' }, stats: {} } as any
    const contact = { id: 'contact-amp-1', orgId: 'org-1', email: 'person@example.com', name: 'Jane Person', firstName: 'Jane', tags: [] } as any

    const ctx = await buildSendContext(broadcast)
    const outcome = await sendBroadcastToContact(ctx, contact, new Set())

    expect(outcome.status).toBe('sent')
    expect(sendCampaignEmail).toHaveBeenCalledWith(expect.not.objectContaining({ amp: expect.anything(), ampHtml: expect.anything() }))
    expect(sendCampaignEmail).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('<img'), text: expect.stringContaining('Home') }))
    expect(emailAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        amp: expect.objectContaining({ requested: true, rendered: true, sent: false, reason: 'send-provider-no-amp-mime-support', fallback: 'html' }),
      }),
    )
  })

  it('enforces a canonical sender policy and persists the resolution snapshot', async () => {
    process.env.RESEND_API_KEY = 're_test'
    const sendCampaignEmail = jest.fn().mockResolvedValue({ ok: true, resendId: 'resend-policy', provider: 'resend' })
    const emailAdd = jest.fn().mockResolvedValue({ id: 'email-policy' })
    const update = jest.fn().mockResolvedValue(undefined)
    const senderPolicy = { id: 'policy-1', orgId: 'org-1', purpose: 'marketing_bulk', strategy: 'contact_owner', enabled: true }
    const collection = jest.fn((name: string) => {
      if (name === 'organizations') return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Acme' }) }) })) }
      if (name === 'emails' || name === 'activities') return { add: emailAdd }
      if (name === 'broadcasts') return { doc: jest.fn(() => ({ update })) }
      return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }) })) }
    })
    jest.doMock('@/lib/firebase/admin', () => ({ adminDb: { collection } }))
    jest.doMock('firebase-admin/firestore', () => ({
      FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'), increment: jest.fn((n: number) => ({ __increment: n })) },
      Timestamp: { now: jest.fn(() => ({ toMillis: () => Date.now(), toDate: () => new Date() })) },
    }))
    jest.doMock('@/lib/email/resend', () => ({
      sendCampaignEmail,
      htmlToPlainText: (html: string) => html.replace(/<[^>]+>/g, ''),
      plainTextToHtml: (text: string) => `<p>${text}</p>`,
    }))
    jest.doMock('@/lib/email/resolveFrom', () => ({
      resolveFrom: jest.fn().mockResolvedValue({ from: 'Legacy <legacy@example.com>', fromDomainId: '', fromDomain: 'example.com', isFallback: true }),
    }))
    jest.doMock('@/lib/email-marketing/sender-store', () => ({ getSenderPolicy: jest.fn().mockResolvedValue(senderPolicy) }))
    jest.doMock('@/lib/email-marketing/sender-resolution', () => ({
      resolveSenderForRecipient: jest.fn().mockResolvedValue({
        status: 'resolved',
        identity: {
          id: 'identity-salesperson', ownerUid: 'sales-1', displayName: 'Alice Sales',
          emailAddress: 'alice@acme.test', replyTo: 'alice@acme.test', mode: 'esp_domain',
          domainId: 'domain-acme', mailboxAccountId: null,
        },
        policyId: 'policy-1', purpose: 'marketing_bulk', resolutionSource: 'contact_owner',
        ownerUid: 'sales-1', reason: null, fallbackReason: null,
      }),
    }))
    jest.doMock('@/lib/email/unsubscribeToken', () => ({ signUnsubscribeToken: jest.fn(() => 'token') }))
    jest.doMock('@/lib/email/suppressions', () => ({ isSuppressed: jest.fn().mockResolvedValue(false) }))
    jest.doMock('@/lib/preferences/store', () => ({ shouldSendToContact: jest.fn().mockResolvedValue({ allowed: true }) }))
    jest.doMock('@/lib/email/frequency', () => ({ isWithinFrequencyCap: jest.fn().mockResolvedValue({ allowed: true }), logFrequencySkip: jest.fn() }))

    const { buildSendContext, sendBroadcastToContact } = await import('@/lib/broadcasts/send')
    const broadcast = {
      id: 'broadcast-policy', orgId: 'org-1', senderPolicyId: 'policy-1', createdBy: 'creator-1',
      fromDomainId: '', fromLocal: 'news', fromName: 'Legacy', replyTo: '',
      content: { templateId: '', subject: 'Hello', bodyHtml: '<p>Hello</p>', bodyText: 'Hello' },
      stats: { audienceSize: 50 },
    } as any
    const contact = { id: 'contact-1', orgId: 'org-1', assignedTo: 'sales-1', email: 'person@example.com', name: 'Person', tags: [] } as any
    const outcome = await sendBroadcastToContact(await buildSendContext(broadcast), contact, new Set())

    expect(outcome.status).toBe('sent')
    expect(sendCampaignEmail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Alice Sales <alice@acme.test>', replyTo: 'alice@acme.test',
    }))
    expect(emailAdd).toHaveBeenCalledWith(expect.objectContaining({
      senderPolicyId: 'policy-1', senderIdentityId: 'identity-salesperson',
      senderOwnerUid: 'sales-1', senderResolutionSource: 'contact_owner',
    }))
  })
})
