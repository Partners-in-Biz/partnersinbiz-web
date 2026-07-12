import {
  adaptBroadcast,
  adaptCampaignRecord,
  adaptCommunicationCampaign,
  adaptSequence,
  type LegacyRecord,
} from '@/lib/email-marketing/adapters'

describe('email program legacy adapters', () => {
  test('adapts a sequence-backed legacy email campaign and preserves org scope', () => {
    const result = adaptCampaignRecord({
      id: 'campaign-1',
      orgId: 'org-a',
      name: 'Welcome nurture',
      status: 'active',
      sequenceId: 'sequence-1',
      segmentId: 'segment-1',
      fromDomainId: 'domain-1',
      createdBy: 'user-1',
    })

    expect(result).toMatchObject({
      ok: true,
      program: {
        id: 'campaign-1',
        orgId: 'org-a',
        kind: 'lifecycle',
        status: 'active',
        workflowVersionId: 'sequence-1',
        source: { collection: 'campaigns', id: 'campaign-1', legacy: true },
      },
    })
  })

  test('identifies a content-engine campaign without pretending it is an email program', () => {
    const result = adaptCampaignRecord({
      id: 'content-1',
      orgId: 'org-a',
      name: 'Q3 content engine',
      status: 'approved',
      clientId: 'client-1',
      clientType: 'b2b-saas',
      research: { audiences: [] },
    })

    expect(result).toEqual({
      ok: false,
      code: 'not_email_program',
      source: { collection: 'campaigns', id: 'content-1', orgId: 'org-a' },
      message: expect.stringContaining('content'),
    })
  })

  test('rejects a legacy campaigns record that matches both incompatible shapes', () => {
    const ambiguous: LegacyRecord = {
      id: 'mixed-1',
      orgId: 'org-a',
      name: 'Mixed record',
      status: 'draft',
      sequenceId: 'sequence-1',
      clientId: 'client-1',
      clientType: 'service-business',
    }

    expect(adaptCampaignRecord(ambiguous)).toMatchObject({
      ok: false,
      code: 'ambiguous_record',
      source: { collection: 'campaigns', id: 'mixed-1', orgId: 'org-a' },
    })
  })

  test('uses explicit recordType instead of optional-field inference for new records', () => {
    const result = adaptCampaignRecord({
      id: 'new-1',
      orgId: 'org-a',
      recordType: 'content_campaign',
      schemaVersion: 2,
      name: 'Explicit content record',
      status: 'draft',
      sequenceId: 'misleading-legacy-field',
    })

    expect(result).toMatchObject({ ok: false, code: 'not_email_program' })
  })

  test('adapts email broadcasts and safely rejects SMS broadcasts', () => {
    expect(adaptBroadcast({
      id: 'broadcast-1', orgId: 'org-a', name: 'Newsletter', status: 'sent',
      channel: 'email', topicId: 'newsletter', content: { subject: 'Hello' },
    })).toMatchObject({
      ok: true,
      program: { orgId: 'org-a', kind: 'newsletter', status: 'completed', preferenceTopicId: 'newsletter' },
    })

    expect(adaptBroadcast({
      id: 'sms-1', orgId: 'org-a', name: 'SMS blast', status: 'draft', channel: 'sms',
    })).toMatchObject({ ok: false, code: 'unsupported_channel' })
  })

  test('adapts sequence and email communications campaign status variants', () => {
    expect(adaptSequence({
      id: 'sequence-1', orgId: 'org-a', name: 'Sales follow-up', status: 'paused',
      programKind: 'sales_sequence', topicId: 'sales',
    })).toMatchObject({
      ok: true,
      program: { kind: 'sales_sequence', status: 'paused', workflowVersionId: 'sequence-1' },
    })

    expect(adaptCommunicationCampaign({
      id: 'comm-1', orgId: 'org-a', name: 'Announcement', channel: 'email',
      status: 'cancelled', templateId: 'template-1', scheduledFor: null,
    })).toMatchObject({
      ok: true,
      program: { kind: 'broadcast', status: 'cancelled', contentVersionId: 'template-1', orgId: 'org-a' },
    })
  })

  test('fails closed when tenant identity is missing', () => {
    expect(adaptSequence({ id: 'sequence-1', name: 'Legacy orphan', status: 'draft' })).toMatchObject({
      ok: false,
      code: 'invalid_record',
    })
  })
})
