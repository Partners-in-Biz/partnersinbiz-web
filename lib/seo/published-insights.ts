export const PUBLISHED_CAMPAIGN_INSIGHT_SLUGS = [
  'ai-agent-ecosystem',
  'end-tool-fragmentation',
  'client-story-r250k-revenue',
  '50-time-saved',
  'how-ai-agents-cut-agency-work-by-80',
  'south-african-pricing',
  'security-and-compliance',
  'how-ai-agents-cut-agency-work-by-80-2',
  'real-time-campaign-reviews',
  'workflow-efficiency',
  'ga4-integration',
  'client-story-r250k-revenue-in-month-1',
  '90-day-growth-sprint',
  'multi-client-management',
] as const

export const PUBLISHED_CAMPAIGN_INSIGHT_PATHS = PUBLISHED_CAMPAIGN_INSIGHT_SLUGS.map(
  slug => `/insights/${slug}`,
)
