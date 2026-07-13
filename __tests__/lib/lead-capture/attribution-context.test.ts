import { buildCaptureAttributionContext } from '@/lib/lead-capture/attribution-context'

describe('capture attribution trust boundary', () => {
  it('keeps self-reported attribution observed and takes campaign lineage only from server config', () => {
    const result = buildCaptureAttributionContext({
      requestUrl: 'https://app.test/submit?utm_source=query-source&gclid=query-click',
      refererHeader: 'https://site.test/landing',
      body: {
        utm_source: 'body-source',
        campaignId: 'spoofed-campaign',
        programId: 'spoofed-program',
        gclid: 'spoofed-click',
        sourceId: 'spoofed-source',
      },
      source: {
        id: 'source-1', name: 'Signup', type: 'form',
        campaignId: 'trusted-campaign', programId: 'trusted-program',
      },
    })

    expect(result.lineage.trusted).toMatchObject({
      sourceId: 'source-1', campaignId: 'trusted-campaign', programId: 'trusted-program',
    })
    expect(result.lineage.observed).toMatchObject({
      utm: { source: 'body-source' }, clickIds: { gclid: 'query-click' },
    })
    expect(JSON.stringify(result)).not.toContain('spoofed-campaign')
    expect(JSON.stringify(result)).not.toContain('spoofed-program')
    expect(JSON.stringify(result)).not.toContain('spoofed-click')
    expect(JSON.stringify(result)).not.toContain('spoofed-source')
  })
})
