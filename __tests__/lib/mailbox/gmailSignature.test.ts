import {
  appendEmailSignature,
  bodyAlreadyHasSignature,
  htmlToPlainText,
} from '@/lib/mailbox/gmailSignature'

describe('htmlToPlainText', () => {
  it('strips tags and normalises common entities', () => {
    expect(htmlToPlainText('<p>Hello&nbsp;<b>World</b></p>')).toBe('Hello World')
    expect(htmlToPlainText('A<br>B')).toBe('A\nB')
    expect(htmlToPlainText('a &amp; b &lt;c&gt;')).toBe('a & b <c>')
  })
})

describe('bodyAlreadyHasSignature', () => {
  it('detects plain signature already present', () => {
    const sig = 'Peet Stander\nPartners in Biz'
    expect(bodyAlreadyHasSignature(`Hi\n\n${sig}`, undefined, sig, '')).toBe(true)
  })

  it('returns false when signature is missing', () => {
    expect(bodyAlreadyHasSignature('Just a short body', undefined, 'Peet Stander\nPartners in Biz', '')).toBe(false)
  })

  it('ignores very short signatures', () => {
    expect(bodyAlreadyHasSignature('Thanks, PS', undefined, 'PS', '')).toBe(false)
  })
})

describe('appendEmailSignature', () => {
  it('appends plain signature with delimiter when absent', () => {
    const result = appendEmailSignature({
      bodyText: 'Hello client,',
      signatureText: 'Peet Stander\nPartners in Biz',
    })
    expect(result.appended).toBe(true)
    expect(result.bodyText).toBe('Hello client,\n\n-- \nPeet Stander\nPartners in Biz')
  })

  it('appends HTML signature block when bodyHtml provided', () => {
    const result = appendEmailSignature({
      bodyText: 'Hello',
      bodyHtml: '<p>Hello</p>',
      signatureHtml: '<div><b>Peet Stander</b><br>Partners in Biz</div>',
    })
    expect(result.appended).toBe(true)
    expect(result.bodyHtml).toContain('pib-email-signature')
    expect(result.bodyHtml).toContain('<b>Peet Stander</b>')
    expect(result.bodyText).toContain('-- ')
    expect(result.bodyText).toContain('Peet Stander')
  })

  it('does not double-append when signature already present', () => {
    const sig = 'Peet Stander\nPartners in Biz'
    const body = `Hello\n\n-- \n${sig}`
    const result = appendEmailSignature({
      bodyText: body,
      signatureText: sig,
    })
    expect(result.appended).toBe(false)
    expect(result.bodyText).toBe(body)
  })

  it('returns unchanged body when no signature available', () => {
    const result = appendEmailSignature({
      bodyText: 'Hello',
      bodyHtml: '<p>Hello</p>',
    })
    expect(result.appended).toBe(false)
    expect(result.bodyText).toBe('Hello')
    expect(result.bodyHtml).toBe('<p>Hello</p>')
  })

  it('builds body from signature alone when body is empty', () => {
    const result = appendEmailSignature({
      bodyText: '',
      signatureText: 'Peet Stander',
    })
    expect(result.appended).toBe(true)
    expect(result.bodyText).toBe('-- \nPeet Stander')
  })
})
