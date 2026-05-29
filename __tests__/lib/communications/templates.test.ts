import {
  buildTemplatePreview,
  extractCommunicationVariables,
  validateMessageTemplate,
} from '@/lib/communications/templates'
import type { MessageTemplate } from '@/lib/communications/types'

const baseTemplate: MessageTemplate = {
  id: 'tpl-1',
  orgId: 'org-1',
  name: 'Points expiry reminder',
  channel: 'whatsapp',
  status: 'approved',
  category: 'utility',
  content: {
    header: 'Hi {{firstName}}',
    body: 'You have {{pointsBalance}} points expiring on {{expiryDate}}.',
    footer: 'Reply HELP for support',
    buttons: [{ type: 'url', label: 'View account', value: 'https://example.com/account' }],
  },
  variables: ['firstName', 'pointsBalance', 'expiryDate'],
  provider: {
    id: 'twilio',
    externalTemplateId: 'HX123',
    approvalStatus: 'approved',
  },
  createdAt: null,
  updatedAt: null,
}

describe('communications templates', () => {
  it('extracts unique variables in first-seen order', () => {
    expect(extractCommunicationVariables('Hi {{ firstName }}, {{points}} / {{firstName}}')).toEqual([
      'firstName',
      'points',
    ])
  })

  it('builds a WhatsApp preview from contact and profile context', () => {
    const preview = buildTemplatePreview(baseTemplate, {
      contact: {
        firstName: 'Sarah',
        lastName: 'Mokoena',
        email: 'sarah@example.com',
      },
      profile: {
        pointsBalance: 1240,
        expiryDate: '2026-06-30',
      },
    })

    expect(preview.channel).toBe('whatsapp')
    expect(preview.header).toBe('Hi Sarah')
    expect(preview.body).toBe('You have 1240 points expiring on 2026-06-30.')
    expect(preview.missingVariables).toEqual([])
  })

  it('reports missing variables without throwing', () => {
    const preview = buildTemplatePreview(baseTemplate, {
      contact: { firstName: 'Sarah' },
    })

    expect(preview.body).toBe('You have  points expiring on .')
    expect(preview.missingVariables).toEqual(['pointsBalance', 'expiryDate'])
  })

  it('validates WhatsApp template category and provider approval readiness', () => {
    const result = validateMessageTemplate({
      ...baseTemplate,
      status: 'draft',
      category: 'transactional' as never,
      provider: { id: 'twilio' },
    })

    expect(result.pass).toBe(false)
    expect(result.issues.map((issue) => issue.id)).toEqual([
      'whatsapp-category-invalid',
      'whatsapp-template-not-approved',
    ])
  })

  it('adds SMS encoding, segment count, and estimated cost to previews', () => {
    const smsTemplate: MessageTemplate = {
      ...baseTemplate,
      id: 'sms-1',
      channel: 'sms',
      content: { body: 'Hi {{firstName}}, your reward is ready 🎁' },
      variables: ['firstName'],
      provider: { id: 'twilio' },
    }

    const preview = buildTemplatePreview(smsTemplate, {
      contact: { firstName: 'Sarah', phone: '+27825551234' },
    })

    expect(preview.sms).toEqual({
      encoding: 'ucs2',
      segments: 1,
      characters: expect.any(Number),
      estimatedCostUsd: 0.04,
    })
  })
})
