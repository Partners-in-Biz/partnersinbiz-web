import type { EmailDocument } from '@/lib/email-builder/types'
import { runEmailPreflight } from '@/lib/email-marketing/preflight'

function baseDocument(): EmailDocument {
  return {
    subject: 'A useful update for {{first_name}}',
    preheader: 'The important details, without the noise.',
    theme: {
      primaryColor: '#0055cc',
      textColor: '#111111',
      backgroundColor: '#ffffff',
      fontFamily: 'Arial, sans-serif',
      contentWidth: 600,
    },
    mergeTagFallbacks: { first_name: 'there' },
    blocks: [
      { id: 'h', type: 'heading', props: { text: 'Hello {{first_name}}', level: 1, align: 'left' } },
      { id: 'p', type: 'paragraph', props: { html: 'A clear paragraph with enough useful information for the reader.', align: 'left' } },
      { id: 'b', type: 'button', props: { text: 'Read the guide', url: 'https://example.com/guide', color: '#0055cc', textColor: '#ffffff', align: 'left', fullWidth: false } },
      { id: 'i', type: 'image', props: { src: 'https://example.com/guide.jpg', alt: 'Guide cover', align: 'center' } },
      { id: 'f', type: 'footer', props: { orgName: 'Acme', address: '1 Main Road', unsubscribeUrl: '{{unsubscribeUrl}}' } },
    ],
  }
}

describe('email authoring preflight', () => {
  it('passes a complete accessible document', () => {
    const result = runEmailPreflight(baseDocument(), { renderedHtmlBytes: 40_000 })
    expect(result.blocking).toBe(false)
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('blocks unknown merge fields, missing fallbacks and compliance footer', () => {
    const doc = baseDocument()
    doc.subject = 'Hi {{unknown_field}} {{company}}'
    doc.mergeTagFallbacks = {}
    doc.blocks = doc.blocks.filter((block) => block.type !== 'footer')

    const result = runEmailPreflight(doc)
    expect(result.blocking).toBe(true)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'merge_unknown', severity: 'error' }),
      expect.objectContaining({ code: 'merge_fallback_missing', severity: 'error' }),
      expect.objectContaining({ code: 'compliance_footer_missing', severity: 'error' }),
    ]))
  })

  it('flags empty image alt text, unsafe links, low contrast and Gmail clipping risk', () => {
    const doc = baseDocument()
    doc.theme.textColor = '#777777'
    doc.theme.backgroundColor = '#888888'
    doc.blocks = doc.blocks.map((block) => {
      if (block.type === 'image') return { ...block, props: { ...block.props, alt: '' } }
      if (block.type === 'button') return { ...block, props: { ...block.props, url: 'javascript:alert(1)' } }
      return block
    })

    const result = runEmailPreflight(doc, { renderedHtmlBytes: 103_000 })
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'image_alt_missing' }),
      expect.objectContaining({ code: 'link_unsafe', severity: 'error' }),
      expect.objectContaining({ code: 'contrast_low' }),
      expect.objectContaining({ code: 'gmail_clipping_risk' }),
    ]))
  })
})
