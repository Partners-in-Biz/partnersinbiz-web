// lib/reports/types.ts
//
// Reports are immutable summaries of an org's KPIs over a time window.
// One row in the `reports` collection. Reports are generated from the
// metrics fact table — never from upstream provider APIs directly.

export type ReportType = 'monthly' | 'quarterly' | 'ad_hoc' | 'launch_review'
export type ReportStatus = 'draft' | 'rendered' | 'sent' | 'archived'

/**
 * Report-type taxonomy (US-175). The `category` is the user-facing taxonomy used
 * for filtering in the workspace; it is distinct from the structural `ReportType`
 * (which drives the snapshot period maths). KPI/monthly reports default to
 * 'monthly'; custom-builder reports are 'custom'; analytics/seo/social/email
 * reports are tagged by the surface that generated them.
 */
export type ReportCategory =
  | 'monthly'
  | 'analytics'
  | 'seo'
  | 'social'
  | 'email'
  | 'custom'

export const REPORT_CATEGORIES: ReportCategory[] = [
  'monthly',
  'analytics',
  'seo',
  'social',
  'email',
  'custom',
]

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  monthly: 'Monthly',
  analytics: 'Analytics',
  seo: 'SEO',
  social: 'Social',
  email: 'Email',
  custom: 'Custom',
}

export interface ReportPeriod {
  start: string // 'YYYY-MM-DD' inclusive
  end: string // 'YYYY-MM-DD' inclusive
  tz: string // IANA timezone the period was closed in
}

/**
 * KPI snapshot — immutable once finalised. Numbers are pre-computed in ZAR
 * for headline comparisons; native amounts in `breakdowns`.
 */
export interface ReportKpis {
  /** Total invoiced revenue (PiB invoices), period sum, ZAR. */
  invoiced_revenue: number
  invoiced_revenue_paid: number
  outstanding: number

  /** Subscription metrics — last value (stock) within period. */
  mrr: number
  arr: number
  active_subs: number
  new_subs: number
  trials_started: number
  trials_converted: number
  churn: number
  subscription_revenue: number

  /** Ad metrics — sum within period, ZAR for revenue, raw counts otherwise. */
  ad_revenue: number
  impressions: number
  clicks: number

  /** Mobile metrics — sum within period. */
  installs: number
  uninstalls: number
  iap_revenue: number

  /** Web/analytics — sum within period. */
  sessions: number
  pageviews: number
  users: number
  conversions: number

  /** Marketing — sum within period. */
  ad_spend: number
  /** Last-row roas in period — closest to current. */
  roas: number | null

  /** Net revenue across all sources, ZAR. */
  total_revenue: number

  /** Period-over-period delta, percentage. null when previous period had 0. */
  deltas: {
    total_revenue: number | null
    mrr: number | null
    active_subs: number | null
    sessions: number | null
    ad_revenue: number | null
    iap_revenue: number | null
    installs: number | null
  }
}

export interface ReportSeries {
  metric: string
  series: Array<{ date: string; value: number }>
}

// ── Custom report builder (US-176) ───────────────────────────────────────────

export type ReportSectionType = 'text' | 'metric' | 'chart' | 'table' | 'page_break'

/** A KPI key that can be pulled from a generated snapshot for metric/chart sections. */
export type ReportMetricKey =
  | 'total_revenue'
  | 'invoiced_revenue'
  | 'invoiced_revenue_paid'
  | 'outstanding'
  | 'mrr'
  | 'arr'
  | 'active_subs'
  | 'new_subs'
  | 'churn'
  | 'subscription_revenue'
  | 'ad_revenue'
  | 'ad_spend'
  | 'impressions'
  | 'clicks'
  | 'installs'
  | 'uninstalls'
  | 'iap_revenue'
  | 'sessions'
  | 'pageviews'
  | 'users'
  | 'conversions'

/** Data source for metric/chart/table sections. `snapshot` pulls live KPIs for the period. */
export interface ReportSectionDataSource {
  /** `snapshot` = computed KPIs for the report period. `manual` = author-supplied values. */
  kind: 'snapshot' | 'manual'
  /** For metric/chart: which KPI to read from the snapshot. */
  metric?: ReportMetricKey
  /** For chart: which series to draw (defaults to the metric). */
  series?: string
  /** For table: ordered KPI keys to render as rows. */
  metrics?: ReportMetricKey[]
  /** For manual sources: explicit value(s). */
  value?: number
  /** For manual table sources: rows of [label, value]. */
  rows?: Array<{ label: string; value: string }>
}

export interface ReportSection {
  id: string
  type: ReportSectionType
  /** Heading / label shown above the section. Optional for page_break. */
  title?: string
  /** Free text body (text section) or caption (others). Supports plain paragraphs split on \n\n. */
  body?: string
  dataSource?: ReportSectionDataSource
}

/** Persisted definition of a custom report (the builder document, distinct from a rendered Report). */
export interface CustomReportSpec {
  title: string
  category: ReportCategory
  /** Period the snapshot data is pulled for. */
  period: ReportPeriod
  sections: ReportSection[]
  propertyId?: string
}

// ── Scheduling (US-177) ───────────────────────────────────────────────────────

export type ScheduleCadence = 'weekly' | 'monthly' | 'quarterly'

export interface ReportSchedule {
  id: string
  orgId: string
  /** Optional source report this schedule re-generates from (custom spec carried forward). */
  sourceReportId?: string | null
  /** Human label shown in the UI. */
  name: string
  cadence: ScheduleCadence
  /** Report category produced on each run. */
  category: ReportCategory
  /** Structural report type used for snapshot maths. */
  type: ReportType
  /** Optional property scope. */
  propertyId?: string | null
  /** Stored custom spec (sections) when category === 'custom'. */
  spec?: CustomReportSpec | null
  /** Recipient emails the rendered report is sent to. */
  recipients: string[]
  /** Email template id used when sending (see lib/reports/templates). */
  template: string
  /** active = runs on cadence; paused = skipped by cron. */
  status: 'active' | 'paused'
  /** ISO date (YYYY-MM-DD) of the next scheduled send. */
  nextSendAt: string
  /** ISO timestamp of the last successful send, or null. */
  lastSentAt: string | null
  /** Emails that have unsubscribed from this schedule. */
  unsubscribed: string[]
  createdAt: unknown
  createdBy: string
  updatedAt: unknown
}

export const REPORT_SCHEDULES_COLLECTION = 'reportSchedules'

// ── Share + open tracking (US-189) ────────────────────────────────────────────

/** A single unique-open event on a public report link. */
export interface ReportOpenEvent {
  id: string
  reportId: string
  /** Hashed visitor fingerprint (IP+UA) — dedupes "unique" opens without storing PII. */
  visitorHash: string
  ipHash: string
  userAgent: string
  referer: string | null
  at: unknown
}

export const REPORT_OPENS_COLLECTION = 'reportOpens'

export interface ReportShareSettings {
  /** Whether the public link resolves. When false the token 404s. */
  enabled: boolean
  /** ISO date (YYYY-MM-DD) after which the link 404s. null = no expiry. */
  expiresAt: string | null
  /** Default email subject when sharing via email. */
  subject?: string
  /** Personal message prepended to share emails. */
  message?: string
}

export interface Report {
  id: string
  orgId: string
  /** Optional single-property scope. Missing means org-wide. */
  propertyId?: string
  type: ReportType
  /** User-facing taxonomy (US-175). Defaults to 'monthly' for KPI reports. */
  category?: ReportCategory
  /** Set when this report was produced by the custom builder (US-176). */
  custom?: CustomReportSpec | null
  period: ReportPeriod
  /** Inclusive prior period used for delta calculations. */
  previousPeriod: ReportPeriod
  status: ReportStatus

  /** Pre-computed KPIs. */
  kpis: ReportKpis

  /** Per-property KPI snapshot. Empty for org-wide reports without property scope. */
  properties: Array<{ propertyId: string; name: string; type: string; kpis: Partial<ReportKpis> }>

  /** Up to ~7 daily series — used to draw mini charts. */
  series: ReportSeries[]

  /** AI-generated 3-paragraph executive summary — editable. */
  exec_summary: string
  /** AI-generated bullet highlights (max 5) — editable. */
  highlights: string[]

  /** Public access token (random 24-byte url-safe). Set on render. Cleared by "Disable link". */
  publicToken: string | null

  /** Share configuration (US-189). */
  share?: ReportShareSettings

  /** Where it was sent. */
  sentTo: string[]
  sentAt: unknown | null
  /**
   * @deprecated Replaced by per-open events in `reportOpens` (US-189). Kept for
   * back-compat rendering; new code should read `openCount` / `uniqueOpenCount`.
   */
  viewedAt: unknown | null
  /** Total open events recorded for this report's public link. */
  openCount?: number
  /** Distinct visitors (by visitorHash) that opened the link. */
  uniqueOpenCount?: number
  /** Timestamp of the most recent open. */
  lastOpenedAt?: unknown | null

  /** Set when this report is produced/maintained by a schedule (US-177). */
  scheduleId?: string | null

  /** Branding — copied at generation time so reports remain stable. */
  brand: {
    orgName: string
    orgLogoUrl: string | null
    accent: string
    bg: string
    text: string
  }

  generatedBy: 'cron' | 'admin' | 'agent'
  createdAt: unknown
  createdBy: string
  updatedAt: unknown
}

export const REPORTS_COLLECTION = 'reports'
