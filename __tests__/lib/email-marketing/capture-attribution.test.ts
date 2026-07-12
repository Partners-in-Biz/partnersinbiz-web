import {
  captureAttributionId,
  normalizeCaptureProvenance,
} from '@/lib/email-marketing/capture-attribution'

describe('capture attribution foundations', () => {
  it('normalizes source, campaign, program, referrer, and supported UTM provenance', () => {
    expect(normalizeCaptureProvenance({
      sourceId: ' src-1 ',
      sourceName: ' Homepage form ',
      sourceType: 'form',
      campaignId: ' camp-1 ',
      programId: ' program-1 ',
      referrer: ' https://example.com/pricing ',
      landingPage: 'https://client.test/?utm_source=google&utm_medium=cpc&utm_campaign=launch',
      utm_source: ' LinkedIn ',
      utm_medium: ' Paid Social ',
      utm_campaign: ' Q3 Launch ',
      utm_term: ' growth platform ',
      utm_content: ' Hero A ',
      gclid: ' abc123 ',
    })).toEqual({
      sourceId: 'src-1',
      sourceName: 'Homepage form',
      sourceType: 'form',
      campaignId: 'camp-1',
      programId: 'program-1',
      referrer: 'https://example.com/pricing',
      landingPage: 'https://client.test/?utm_source=google&utm_medium=cpc&utm_campaign=launch',
      utm: {
        source: 'linkedin',
        medium: 'paid social',
        campaign: 'q3 launch',
        term: 'growth platform',
        content: 'hero a',
      },
      clickIds: { gclid: 'abc123' },
    })
  })

  it('derives UTMs from the landing URL and strips fragments when explicit fields are absent', () => {
    expect(normalizeCaptureProvenance({
      sourceId: 'src-1',
      landingPage: 'https://client.test/signup?utm_source=Newsletter&utm_campaign=July#private-fragment',
    })).toEqual(expect.objectContaining({
      landingPage: 'https://client.test/signup?utm_source=Newsletter&utm_campaign=July',
      utm: { source: 'newsletter', campaign: 'july' },
    }))
  })

  it('drops unsafe URLs and bounds untrusted attribution values', () => {
    const result = normalizeCaptureProvenance({
      sourceId: 'src-1',
      referrer: 'javascript:alert(1)',
      landingPage: 'data:text/html,bad',
      utm_source: 'x'.repeat(500),
    })
    expect(result.referrer).toBe('')
    expect(result.landingPage).toBe('')
    expect(result.utm.source).toHaveLength(200)
  })

  it('builds an org-scoped stable idempotency id', () => {
    const first = captureAttributionId('org-1', 'src-1', 'submission-1')
    expect(first).toBe(captureAttributionId('org-1', 'src-1', 'submission-1'))
    expect(first).not.toBe(captureAttributionId('org-2', 'src-1', 'submission-1'))
  })
})
