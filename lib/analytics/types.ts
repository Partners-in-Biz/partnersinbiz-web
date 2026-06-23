// lib/analytics/types.ts

export type DeviceType = 'mobile' | 'tablet' | 'desktop'
export type FunnelWindow = 'session' | '1h' | '24h' | '7d' | '30d'

export const VALID_FUNNEL_WINDOWS: FunnelWindow[] = ['session', '1h', '24h', '7d', '30d']

export const WINDOW_MS: Record<Exclude<FunnelWindow, 'session'>, number> = {
  '1h':  1 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

export interface AnalyticsEvent {
  id: string
  orgId: string
  propertyId: string
  sessionId: string
  distinctId: string
  userId: string | null
  event: string
  properties: Record<string, unknown>
  pageUrl: string | null
  referrer: string | null
  userAgent: string | null
  ipHash: string | null
  country: string | null
  device: DeviceType | null
  timestamp: unknown  // Firestore Timestamp — serialised as { _seconds, _nanoseconds }
  serverTime: unknown
}

export interface AnalyticsSession {
  id: string
  orgId: string
  propertyId: string
  distinctId: string
  userId: string | null
  startedAt: unknown
  lastActivityAt: unknown
  endedAt: unknown | null
  eventCount: number
  pageCount: number
  referrer: string | null
  landingUrl: string | null
  country: string | null
  device: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  convertedEvents: string[]
}

export interface FunnelStep {
  event: string
  filters?: Record<string, unknown>
}

export interface AnalyticsFunnel {
  id: string
  orgId: string
  propertyId: string
  name: string
  steps: FunnelStep[]
  window: FunnelWindow
  createdBy: string
  createdAt: unknown
  updatedAt: unknown
}

export interface FunnelStepResult {
  event: string
  count: number
  conversionFromPrev: number | null
}

export interface FunnelResults {
  steps: FunnelStepResult[]
  totalEntered: number
  totalConverted: number
}

export interface IngestEventInput {
  event: string
  distinctId: string
  sessionId: string
  userId?: string | null
  properties?: Record<string, unknown>
  timestamp?: string
  pageUrl?: string | null
  referrer?: string | null
  userAgent?: string | null
  utm?: {
    source?: string
    medium?: string
    campaign?: string
    content?: string
  }
}

export interface IngestBody {
  propertyId: string
  events: IngestEventInput[]
}

export interface IngestResult {
  accepted: number
  rejected: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// Segment filters (US-133, US-143) — applied to product_sessions/product_events
// ---------------------------------------------------------------------------

export type SegmentVisitorType = 'all' | 'new' | 'returning'

export interface AnalyticsSegment {
  /** new vs returning visitor (derived from distinctId session count) */
  visitorType?: SegmentVisitorType
  /** device class filter */
  device?: DeviceType | null
  /** utmSource exact-match filter */
  source?: string | null
  /** ISO country code filter */
  country?: string | null
  /** CRM dynamic-segment id (resolves to a set of distinctIds via userId) */
  crmSegmentId?: string | null
}

export const VALID_VISITOR_TYPES: SegmentVisitorType[] = ['all', 'new', 'returning']

// ---------------------------------------------------------------------------
// Conversion goals (US-128, US-142)
// ---------------------------------------------------------------------------

export type GoalType = 'event' | 'pageview' | 'duration'

export interface AnalyticsGoal {
  id: string
  orgId: string
  propertyId: string
  name: string
  type: GoalType
  /** event name (type=event) or page-URL match (type=pageview) */
  target: string
  /** min seconds (type=duration) */
  minDuration?: number | null
  /** monetary value in ZAR credited per completion (US-142) */
  value: number
  active: boolean
  createdAt: unknown
  updatedAt: unknown
}

// ---------------------------------------------------------------------------
// Custom event registry (US-130)
// ---------------------------------------------------------------------------

export interface CustomEventDef {
  id: string
  orgId: string
  propertyId: string
  /** event name as fired via .track() */
  name: string
  description: string
  /** documented property keys */
  properties: string[]
  createdAt: unknown
  updatedAt: unknown
}

// ---------------------------------------------------------------------------
// Scheduled reports (US-135)
// ---------------------------------------------------------------------------

export type ReportFrequency = 'weekly' | 'monthly'

export interface ScheduledReport {
  id: string
  orgId: string
  propertyId: string
  name: string
  frequency: ReportFrequency
  metrics: string[]
  recipients: string[]
  active: boolean
  lastRunAt: unknown | null
  createdAt: unknown
  updatedAt: unknown
}

export interface ReportRun {
  id: string
  reportId: string
  propertyId: string
  ranAt: unknown
  rangeFrom: string
  rangeTo: string
  recipients: string[]
  status: 'sent' | 'failed'
  metrics: Record<string, number>
  error?: string | null
}

// ---------------------------------------------------------------------------
// Attribution (US-146)
// ---------------------------------------------------------------------------

export type AttributionModel = 'last' | 'first' | 'linear' | 'time_decay'

export const VALID_ATTRIBUTION_MODELS: AttributionModel[] = ['last', 'first', 'linear', 'time_decay']

export interface Touchpoint {
  source: string
  medium: string
  campaign: string
  timestamp: number
}

export type RetentionGranularity = 'day' | 'week'

export interface RetentionCohortRow {
  cohortLabel: string        // e.g. "2026-04-07" (day) or "2026-W15" (week)
  cohortStart: number        // Unix ms — start of the cohort period
  cohortSize: number         // distinct users who fired the cohort event in this period
  periods: (number | null)[] // retention % for period 0, 1, 2 … N (period 0 = 100% always)
}

export interface RetentionResult {
  granularity: RetentionGranularity
  cohortEvent: string
  returnEvent: string
  maxPeriods: number
  rows: RetentionCohortRow[]
}
