import { buildCommunicationAnalytics } from '@/lib/communications/analytics'
import type {
  CommunicationCampaign,
  CommunicationEvent,
  Conversation,
} from '@/lib/communications/types'

describe('communications analytics', () => {
  it('rolls up channel, campaign, opt-out, and workload metrics', () => {
    const conversations: Conversation[] = [
      {
        id: 'conv-1',
        orgId: 'org-1',
        channel: 'whatsapp',
        status: 'open',
        priority: 'normal',
        contactId: 'contact-1',
        contactSnapshot: { name: 'Sarah' },
        queueId: 'support',
        assigneeAgentId: 'nora',
        assigneeUserId: null,
        labels: ['campaign-reply'],
        campaignId: 'camp-1',
        lastMessageAt: null,
        snoozedUntil: null,
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'conv-2',
        orgId: 'org-1',
        channel: 'sms',
        status: 'resolved',
        priority: 'normal',
        contactId: null,
        contactSnapshot: {},
        queueId: 'support',
        assigneeAgentId: null,
        assigneeUserId: 'user-1',
        labels: [],
        campaignId: null,
        lastMessageAt: null,
        snoozedUntil: null,
        createdAt: null,
        updatedAt: null,
      },
    ]
    const campaigns: CommunicationCampaign[] = [
      {
        id: 'camp-1',
        orgId: 'org-1',
        name: 'Gold expiry',
        channel: 'whatsapp',
        status: 'sent',
        templateId: 'tpl-1',
        audience: { segmentId: 'gold', contactIds: [], tags: ['gold'] },
        variableMap: { firstName: 'firstName' },
        replyRouting: { queueId: 'support' },
        scheduledFor: null,
        stats: {
          sent: 10,
          delivered: 9,
          read: 8,
          replies: 2,
          clicks: 3,
          optOuts: 1,
          failed: 1,
          costUsd: 0.6,
        },
        createdAt: null,
        updatedAt: null,
      },
    ]
    const events: CommunicationEvent[] = [
      {
        id: 'event-1',
        orgId: 'org-1',
        type: 'opt_out.recorded',
        channel: 'whatsapp',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        campaignId: 'camp-1',
        payload: {},
        createdAt: null,
      },
    ]

    const analytics = buildCommunicationAnalytics({ conversations, campaigns, events })

    expect(analytics.channelVolume.whatsapp.totalConversations).toBe(1)
    expect(analytics.channelVolume.sms.resolved).toBe(1)
    expect(analytics.campaigns[0]).toMatchObject({
      id: 'camp-1',
      deliveredRate: 0.9,
      readRate: 0.8,
      replyRate: 0.2,
      costUsd: 0.6,
    })
    expect(analytics.optOuts.total).toBe(1)
    expect(analytics.workload.byQueue.support.open).toBe(1)
    expect(analytics.workload.byAgent.nora.total).toBe(1)
  })
})
