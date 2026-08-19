// lib/types/campaign.ts
//
// Content-engine "Campaign" — the top-level grouping for a multi-asset content
// run (research dossier + brand identity + pillars + 12-week calendar + the
// produced social posts / blogs / videos). Distinct from the email-program
// `Campaign` interface in `lib/campaigns/types.ts`.

import type { Timestamp } from 'firebase-admin/firestore'

export type CampaignClientType = 'service-business' | 'consumer-app' | 'b2b-saas'

export type CampaignStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'shipping'
  | 'archived'

export interface AudienceProfile {
  id: 'A' | 'B' | string
  label: string
  painPoints: string[]
  language: string[]
  channels: string[]
  topInsights: string[]
}

export interface ChannelMix {
  primary: string[]
  secondary: string[]
  experimental: string[]
}

export interface CitationSource {
  quote: string
  speaker?: string
  publication: string
  url: string
  date?: string
}

export interface CampaignResearch {
  audiences: AudienceProfile[]
  voice: { do: string[]; dont: string[]; sampleParagraph: string }
  taglines: {
    master: string
    layered: { hero: string; analytics: string; simplification: string }
  }
  channels: ChannelMix
  citations: CitationSource[]
  confidence: 'low' | 'medium' | 'high'
  notes: string
}

export interface CampaignBrandIdentity {
  palette: {
    bg: string
    accent: string
    alert: string
    text: string
    muted?: string
  }
  typography: { heading: string; body: string; numeric?: string }
  logoUrl?: string
  aestheticKeywords: string[]
  tone: string
}

export interface CampaignPillar {
  id: string
  name: string
  description: string
  weight: number
}

export interface CampaignCalendarEntry {
  day: number
  date: string
  audience: 'A' | 'B' | string
  pillarId: string
  channel: string
  format: string
  title: string
  assetId?: string
  assetType?: 'social_post' | 'seo_content' | 'video'
}

export interface Campaign {
  id: string
  orgId: string
  clientId: string
  name: string
  clientType: CampaignClientType
  status: CampaignStatus

  research?: CampaignResearch
  brandIdentity?: CampaignBrandIdentity
  pillars?: CampaignPillar[]
  calendar?: CampaignCalendarEntry[]

  shareToken: string
  shareEnabled: boolean

  accountScope?: 'org' | 'personal'
  ownerUid?: string | null

  createdAt: Timestamp | null
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
  updatedAt: Timestamp | null
  updatedBy: string
  updatedByType: 'user' | 'agent' | 'system'
  deleted: boolean
}

// Roll-up returned by GET /campaigns/[id]/assets and the public share route.
// Keeps existing collection types loose since this module shouldn't leak full
// SocialPost / SeoContent typings (which live inline elsewhere).
export interface CampaignAssets {
  campaignId: string
  social: Array<Record<string, unknown> & { id: string }>
  blogs: Array<
    Record<string, unknown> & {
      id: string
      draft?: { wordCount: number; generatedBy: string } | null
    }
  >
  videos: Array<Record<string, unknown> & { id: string }>
  meta: {
    totals: { social: number; blogs: number; videos: number }
    byStatus: {
      draft: number
      pending_approval: number
      approved: number
      published: number
    }
  }
}
