import { runPreflight } from '@/lib/email/preflight'
import type { EmailDocument } from '@/lib/email-builder/types'

const ampDoc: EmailDocument = {
  subject: 'Monthly update',
  preheader: 'See what is new',
  theme: {
    primaryColor: '#F5A623',
    textColor: '#0A0A0B',
    backgroundColor: '#F4F4F5',
    fontFamily: 'Arial, sans-serif',
    contentWidth: 600,
  },
  blocks: [
    {
      id: 'amp-1',
      type: 'amp-carousel',
      props: {
        slides: [
          {
            imageUrl: 'https://cdn.example.com/one.jpg',
            alt: 'Featured property',
            linkUrl: 'https://example.com/property',
          },
        ],
      },
    },
    {
      id: 'footer-1',
      type: 'footer',
      props: {
        orgName: 'Acme',
        address: '1 Market Street',
        unsubscribeUrl: '{{unsubscribeUrl}}',
        preferencesUrl: '{{preferencesUrl}}',
      },
    },
  ],
}

describe('email preflight AMP fallback decision', () => {
  it('documents AMP send-pipeline fallback as info without blocking send', async () => {
    const report = await runPreflight({
      subject: ampDoc.subject,
      preheader: ampDoc.preheader,
      bodyHtml: '<p>Hello there, this has enough readable copy for a safe fallback.</p><a href="https://example.com">Read more</a><p>Unsubscribe Preferences</p>',
      bodyText: 'Hello there, this has enough readable copy for a safe fallback. Read more. Unsubscribe Preferences.',
      document: ampDoc,
      fromName: 'Acme',
      fromAddress: 'news@example.com',
      hasUnsubscribeUrl: true,
      hasPreferencesUrl: true,
    })

    expect(report.pass).toBe(true)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'amp-send-fallback',
          severity: 'info',
          title: 'AMP blocks will send as HTML fallback',
        }),
      ]),
    )
  })
})
