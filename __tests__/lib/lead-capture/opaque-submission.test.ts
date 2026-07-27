import {
  isOpaqueEnquirySpam,
  looksLikeOpaqueSubmittedId,
  looksLikePhoneNumber,
  looksLikeUrl,
} from '@/lib/lead-capture/opaque-submission'

describe('opaque enquiry spam detection', () => {
  it('flags the live Gauteng Growth Audit bot tokens', () => {
    expect(looksLikeOpaqueSubmittedId('iOaLYqVVIyexllUXRQNQTG')).toBe(true)
    expect(looksLikeOpaqueSubmittedId('NAIYZZTjfFcuitpae')).toBe(true)
    expect(looksLikeOpaqueSubmittedId('uWktLdFgyTRjsekNCz')).toBe(true)
    expect(isOpaqueEnquirySpam({
      name: 'iOaLYqVVIyexllUXRQNQTG',
      company: 'NAIYZZTjfFcuitpae',
      phone: 'uWktLdFgyTRjsekNCz',
      website: 'NAIYZZTjfFcuitpae',
    })).toBe(true)
  })

  it('keeps legitimate human values', () => {
    expect(looksLikeOpaqueSubmittedId('Ava Owner')).toBe(false)
    expect(looksLikeOpaqueSubmittedId('PartnersInBizOnline')).toBe(false)
    expect(looksLikeUrl('https://avaflorist.co.za')).toBe(true)
    expect(looksLikePhoneNumber('067 896 6333')).toBe(true)
    expect(isOpaqueEnquirySpam({
      name: 'Ava Owner',
      company: 'Ava Florist',
      phone: '067 896 6333',
      website: 'https://avaflorist.co.za',
    })).toBe(false)
  })
})
