export interface SeoTaskTemplate {
  week: number
  phase: 0 | 1 | 2 | 3
  focus: string
  title: string
  description?: string
  taskType: string             // e.g. 'meta-tag-draft', 'directory-submission'
  autopilotEligible: boolean   // default whether Pip can run it solo
  internalToolPath?: string    // points to /admin/seo/tools/...
}

export interface SeoTemplate {
  id: string
  version: number
  name: string
  tasks: SeoTaskTemplate[]
}

export const OUTRANK_90: SeoTemplate = {
  id: 'outrank-90',
  version: 1,
  name: 'Outrank 90-Day SEO Sprint',
  tasks: [
    // Phase 0 — Pre-launch (Week 0)
    { week: 0, phase: 0, focus: 'Pre-launch', title: 'Set up meta tags on every page (title, description, OG image)', taskType: 'meta-tag-audit', autopilotEligible: true, internalToolPath: '/admin/seo/tools#metadata-check' },
    { week: 0, phase: 0, focus: 'Pre-launch', title: 'Add SoftwareApplication + FAQ schema (structured data)', taskType: 'schema-add', autopilotEligible: true },
    { week: 0, phase: 0, focus: 'Pre-launch', title: 'Verify site in Google Search Console', taskType: 'gsc-verify', autopilotEligible: false },
    { week: 0, phase: 0, focus: 'Pre-launch', title: 'Submit sitemap.xml to GSC', taskType: 'sitemap-submit', autopilotEligible: true, internalToolPath: '/admin/seo/tools#sitemap-check' },
    { week: 0, phase: 0, focus: 'Pre-launch', title: 'Manually request indexing for 5 core pages', taskType: 'gsc-request-index', autopilotEligible: false },
    { week: 0, phase: 0, focus: 'Pre-launch', title: 'Set up Bing Webmaster Tools (import from GSC)', taskType: 'bing-verify', autopilotEligible: false },
    { week: 0, phase: 0, focus: 'Pre-launch', title: 'Cross-link from existing property to new site', taskType: 'cross-link', autopilotEligible: false },
    // Phase 1 — Foundation (Weeks 1-4)
    { week: 1, phase: 1, focus: 'Tech Audit', title: 'Check robots.txt — nothing blocking crawlers', taskType: 'robots-check', autopilotEligible: true, internalToolPath: '/admin/seo/tools#robots-check' },
    { week: 1, phase: 1, focus: 'Tech Audit', title: 'Check all core pages are being indexed in GSC', taskType: 'gsc-index-check', autopilotEligible: true },
    { week: 1, phase: 1, focus: 'Tech Audit', title: 'Check page speed at pagespeed.web.dev', taskType: 'pagespeed-check', autopilotEligible: true },
    { week: 1, phase: 1, focus: 'Tech Audit', title: 'Confirm Core Web Vitals: LCP < 2.5s, CLS minimal', taskType: 'cwv-check', autopilotEligible: true },
    { week: 1, phase: 1, focus: 'Tech Audit', title: 'Check canonical tags on all key pages', taskType: 'canonical-check', autopilotEligible: true, internalToolPath: '/admin/seo/tools#canonical-check' },
    { week: 1, phase: 1, focus: 'Tech Audit', title: 'Add alt text to all images', taskType: 'alt-text-audit', autopilotEligible: false },
    { week: 1, phase: 1, focus: 'Tech Audit', title: 'Add noindex to login, dashboard, onboarding pages', taskType: 'noindex-add', autopilotEligible: false },
    { week: 2, phase: 1, focus: 'Keywords', title: 'Pick 20–30 winnable keywords (DR of top 3 results < 50)', taskType: 'keyword-discover', autopilotEligible: true, internalToolPath: '/admin/seo/tools#keyword-discover' },
    { week: 2, phase: 1, focus: 'Keywords', title: 'Sort keywords into 3 intent buckets (Problem / Solution / Brand)', taskType: 'keyword-bucket', autopilotEligible: true },
    { week: 2, phase: 1, focus: 'Keywords', title: 'Identify 5 keywords for immediate content (solution-aware first)', taskType: 'keyword-prioritize', autopilotEligible: true },
    { week: 2, phase: 1, focus: 'Keywords', title: 'Record all keywords in the Keywords tab', taskType: 'keyword-record', autopilotEligible: true },
    { week: 3, phase: 1, focus: 'Core Pages', title: 'Write homepage with primary keyword in H1', taskType: 'page-write', autopilotEligible: true, internalToolPath: '/admin/seo/tools#title-generate' },
    { week: 3, phase: 1, focus: 'Core Pages', title: 'Write primary use-case page', taskType: 'page-write', autopilotEligible: true },
    { week: 3, phase: 1, focus: 'Core Pages', title: 'Write first comparison page (you vs category leader)', taskType: 'page-write', autopilotEligible: true },
    { week: 4, phase: 1, focus: 'Core Pages', title: 'Add FAQ schema to all three core pages', taskType: 'schema-add', autopilotEligible: true },
    { week: 4, phase: 1, focus: 'Core Pages', title: 'Add internal links between core pages', taskType: 'internal-link-add', autopilotEligible: true },
    // Phase 2 — Content engine (Weeks 5-10)
    { week: 5, phase: 2, focus: 'Content', title: 'Publish post 1 — comparison or alternative format', taskType: 'post-publish', autopilotEligible: false },
    { week: 5, phase: 2, focus: 'Content', title: 'Repurpose post 1 → LinkedIn post + X thread', taskType: 'post-repurpose', autopilotEligible: false },
    { week: 6, phase: 2, focus: 'Content', title: 'Publish post 2 — use-case format', taskType: 'post-publish', autopilotEligible: false },
    { week: 6, phase: 2, focus: 'Content', title: 'Repurpose post 2 → LinkedIn post + X thread', taskType: 'post-repurpose', autopilotEligible: false },
    { week: 7, phase: 2, focus: 'Pillar Post', title: 'Publish pillar post (2,000+ words on core topic)', taskType: 'pillar-publish', autopilotEligible: false },
    { week: 7, phase: 2, focus: 'Pillar Post', title: 'Add internal links from all existing posts to pillar', taskType: 'internal-link-add', autopilotEligible: true },
    { week: 8, phase: 2, focus: 'pSEO', title: 'Launch feature page templates', taskType: 'pseo-feature', autopilotEligible: false },
    { week: 8, phase: 2, focus: 'pSEO', title: 'Launch alternative/comparison page templates', taskType: 'pseo-comparison', autopilotEligible: false },
    { week: 9, phase: 2, focus: 'Backlinks', title: 'Submit to 15 SaaS directories (log in Backlinks tab)', taskType: 'directory-submission', autopilotEligible: true },
    { week: 9, phase: 2, focus: 'Backlinks', title: 'DM 3 founders for link trades', taskType: 'link-trade-dm', autopilotEligible: false },
    { week: 10, phase: 2, focus: 'Backlinks', title: 'Pitch 1 guest post to a relevant DR 40+ blog', taskType: 'guest-post-pitch', autopilotEligible: false },
    { week: 10, phase: 2, focus: 'Backlinks', title: 'Submit to IndieHackers and relevant subreddits', taskType: 'community-post', autopilotEligible: false },
    // Phase 3 — Authority (Weeks 11-13)
    { week: 11, phase: 3, focus: 'Authority', title: 'Open GSC — find pages ranking position 8–20', taskType: 'gsc-stuck-pages', autopilotEligible: true },
    { week: 11, phase: 3, focus: 'Authority', title: 'Update each position 8–20 page (add depth, FAQ, structure)', taskType: 'page-rewrite', autopilotEligible: true },
    { week: 12, phase: 3, focus: 'Cluster', title: 'Pick one keyword theme for content cluster', taskType: 'cluster-pick', autopilotEligible: true },
    { week: 12, phase: 3, focus: 'Cluster', title: 'Publish 5–7 supporting posts around pillar — all interlinked', taskType: 'cluster-publish', autopilotEligible: false },
    { week: 13, phase: 3, focus: 'Day 90 Audit', title: 'Pull all metrics: impressions, clicks, DR, keywords', taskType: 'audit-snapshot', autopilotEligible: true },
    { week: 13, phase: 3, focus: 'Day 90 Audit', title: 'Fill in Day 90 Audit tab and screenshot it', taskType: 'audit-render', autopilotEligible: true },
    { week: 13, phase: 3, focus: 'Day 90 Audit', title: 'Post your GSC impressions chart on X/LinkedIn', taskType: 'audit-announce', autopilotEligible: false },
  ],
}
