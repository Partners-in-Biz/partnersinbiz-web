/**
 * Detect bot-filled “opaque” identity tokens on public enquiry/lead forms.
 *
 * Spam bots often submit long mixed-case alphanumeric strings with no spaces
 * (e.g. iOaLYqVVIyexllUXRQNQTG) instead of human names, phones, or URLs.
 * Briefings already scrub these for display; intake should reject them.
 */

export function looksLikeOpaqueSubmittedId(value: string | null | undefined): boolean {
  if (!value || /\s/.test(value)) return false
  const text = value.trim()
  if (!text) return false
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    return true
  }
  if (text.length < 16 || !/^[A-Za-z0-9_-]+$/.test(text)) return false
  const uppercase = (text.match(/[A-Z]/g) ?? []).length
  const lowercase = (text.match(/[a-z]/g) ?? []).length
  return uppercase >= 6 && lowercase >= 6
}

export function looksLikeUrl(value: string | null | undefined): boolean {
  if (!value) return false
  const text = value.trim()
  if (!text) return false
  if (/^https?:\/\//i.test(text)) return true
  if (/\./.test(text) && /[a-z]/i.test(text) && !looksLikeOpaqueSubmittedId(text)) return true
  return false
}

export function looksLikePhoneNumber(value: string | null | undefined): boolean {
  if (!value) return false
  const digits = value.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

export type OpaqueEnquiryFields = {
  name?: string | null
  company?: string | null
  phone?: string | null
  website?: string | null
}

/**
 * True when the payload looks like the automated opaque-token spam pattern
 * seen on /gauteng-growth-audit and partner enquiry forms.
 */
export function isOpaqueEnquirySpam(fields: OpaqueEnquiryFields): boolean {
  const name = typeof fields.name === 'string' ? fields.name.trim() : ''
  const company = typeof fields.company === 'string' ? fields.company.trim() : ''
  const phone = typeof fields.phone === 'string' ? fields.phone.trim() : ''
  const website = typeof fields.website === 'string' ? fields.website.trim() : ''

  if (name && looksLikeOpaqueSubmittedId(name)) return true
  if (phone && !looksLikePhoneNumber(phone) && looksLikeOpaqueSubmittedId(phone)) return true

  const companyOpaque = Boolean(company) && looksLikeOpaqueSubmittedId(company) && !looksLikeUrl(company)
  const websiteOpaque = Boolean(website) && looksLikeOpaqueSubmittedId(website) && !looksLikeUrl(website)
  if (companyOpaque || websiteOpaque) return true

  return false
}
