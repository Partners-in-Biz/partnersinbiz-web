import {
  COMMUNICATION_CHANNELS,
  type CommunicationCampaign,
  type CommunicationChannel,
  type CommunicationEvent,
  type Conversation,
  type ConversationStatus,
} from './types'

interface RollupInput {
  conversations: Conversation[]
  campaigns: CommunicationCampaign[]
  events: CommunicationEvent[]
}

type StatusCounters = Record<ConversationStatus, number>

interface ChannelVolume extends StatusCounters {
  totalConversations: number
  inbound: number
  outbound: number
}

interface WorkloadBucket extends StatusCounters {
  total: number
}

export function buildCommunicationAnalytics({ conversations, campaigns, events }: RollupInput) {
  const channelVolume = Object.fromEntries(
    COMMUNICATION_CHANNELS.map((channel) => [channel, emptyChannelVolume()]),
  ) as Record<CommunicationChannel, ChannelVolume>
  const byQueue: Record<string, WorkloadBucket> = {}
  const byAgent: Record<string, WorkloadBucket> = {}
  const optOutsByChannel = Object.fromEntries(
    COMMUNICATION_CHANNELS.map((channel) => [channel, 0]),
  ) as Record<CommunicationChannel, number>

  conversations.forEach((conversation) => {
    const channel = channelVolume[conversation.channel] ?? emptyChannelVolume()
    channel.totalConversations += 1
    channel[conversation.status] += 1
    if (conversation.lastInboundMessageAt) channel.inbound += 1
    if (conversation.lastOutboundMessageAt) channel.outbound += 1
    channelVolume[conversation.channel] = channel

    if (conversation.queueId) incrementWorkload(byQueue, conversation.queueId, conversation.status)
    const agentId = conversation.assigneeAgentId ?? conversation.assigneeUserId
    if (agentId) incrementWorkload(byAgent, agentId, conversation.status)
  })

  events.forEach((event) => {
    if (event.type === 'opt_out.recorded') optOutsByChannel[event.channel] += 1
  })

  return {
    channelVolume,
    campaigns: campaigns.map((campaign) => {
      const sent = campaign.stats.sent || 0
      return {
        id: campaign.id,
        name: campaign.name,
        channel: campaign.channel,
        sent,
        delivered: campaign.stats.delivered,
        read: campaign.stats.read,
        replies: campaign.stats.replies,
        clicks: campaign.stats.clicks,
        optOuts: campaign.stats.optOuts,
        failed: campaign.stats.failed,
        costUsd: campaign.stats.costUsd,
        deliveredRate: ratio(campaign.stats.delivered, sent),
        readRate: ratio(campaign.stats.read, sent),
        replyRate: ratio(campaign.stats.replies, sent),
        clickRate: ratio(campaign.stats.clicks, sent),
        optOutRate: ratio(campaign.stats.optOuts, sent),
      }
    }),
    optOuts: {
      total: Object.values(optOutsByChannel).reduce((sum, count) => sum + count, 0),
      byChannel: optOutsByChannel,
    },
    workload: {
      byQueue,
      byAgent,
    },
  }
}

function emptyChannelVolume(): ChannelVolume {
  return {
    totalConversations: 0,
    inbound: 0,
    outbound: 0,
    new: 0,
    open: 0,
    pending: 0,
    resolved: 0,
    snoozed: 0,
  }
}

function emptyWorkload(): WorkloadBucket {
  return {
    total: 0,
    new: 0,
    open: 0,
    pending: 0,
    resolved: 0,
    snoozed: 0,
  }
}

function incrementWorkload(target: Record<string, WorkloadBucket>, key: string, status: ConversationStatus) {
  const bucket = target[key] ?? emptyWorkload()
  bucket.total += 1
  bucket[status] += 1
  target[key] = bucket
}

function ratio(value: number, total: number): number {
  if (!total) return 0
  return Number((value / total).toFixed(4))
}
