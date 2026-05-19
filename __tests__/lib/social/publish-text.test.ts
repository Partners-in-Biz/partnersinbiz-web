import { prepareSocialPublishText, validatePublishReadyText } from '@/lib/social/publish-text'

describe('social publish text guard', () => {
  it('blocks carousel production briefs before publishing', () => {
    const result = validatePublishReadyText(
      '# LinkedIn carousel - 8 slides\n\nBrand colours, dark background. Each slide footer reads `Slide N of 8 · partnersinbiz.online/properties`.',
      ['linkedin'],
    )

    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toContain('carousel production brief')
  })

  it('blocks short video production briefs before publishing', () => {
    const result = validatePublishReadyText(
      '# Short video script - 75 seconds\n\n**Format:** Vertical 9:16 screen recording. No voiceover except the opening line. On-screen text carries the narrative.',
      ['linkedin'],
    )

    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toContain('video production brief')
  })

  it('removes markdown code ticks around URLs before provider publish', () => {
    expect(prepareSocialPublishText('Go here: `partnersinbiz.online/properties`.')).toBe(
      'Go here: partnersinbiz.online/properties.',
    )
  })

  it('allows real post copy with a markdown heading', () => {
    const result = validatePublishReadyText(
      '# LinkedIn post (200 words, founder voice)\n\nPicture this. A client calls at 9pm Friday. They want the booking form off for the weekend.',
      ['linkedin'],
    )

    expect(result.valid).toBe(true)
    expect(result.text).toBe(
      'Picture this. A client calls at 9pm Friday. They want the booking form off for the weekend.',
    )
  })
})
