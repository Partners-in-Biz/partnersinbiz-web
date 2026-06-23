import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
  experimental: {
    webpackMemoryOptimizations: true,
  },
  transpilePackages: ['@partnersinbiz/analytics-js'],
  serverExternalPackages: ['@react-pdf/renderer'],
  webpack(config, { dev }) {
    if (!dev) {
      config.cache = false
    }

    return config
  },
  typescript: {
    // The Vercel build script runs `npm run typecheck` before Next compiles.
    // Skipping the duplicate Next type pass keeps preview builds under memory limits.
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
  },
  async redirects() {
    return [
      { source: '/discover', destination: '/work', permanent: true },
      { source: '/products', destination: '/services/web-applications', permanent: true },
      // P1.1 CRM convergence: admin top-level CRM → portal (portal is the only CRM workspace)
      { source: '/admin/crm', destination: '/portal/crm', permanent: false },
      { source: '/admin/crm/contacts/:path*', destination: '/portal/contacts/:path*', permanent: false },
      { source: '/admin/crm/contacts', destination: '/portal/contacts', permanent: false },
      { source: '/admin/crm/pipeline', destination: '/portal/deals', permanent: false },
      { source: '/admin/crm/:path*', destination: '/portal/crm', permanent: false },
      // P1.2 org/clients convergence: admin/clients folds into admin/organizations
      { source: '/admin/clients', destination: '/admin/organizations', permanent: false },
      { source: '/admin/clients/:path*', destination: '/admin/organizations/:path*', permanent: false },
      // P2 research convergence: portal is the only research workspace
      { source: '/admin/research', destination: '/portal/research', permanent: false },
      { source: '/admin/research/:path*', destination: '/portal/research/:path*', permanent: false },
      // P2 communications convergence: portal is the only communications workspace
      { source: '/admin/communications', destination: '/portal/communications', permanent: false },
      { source: '/admin/communications/:path*', destination: '/portal/communications/:path*', permanent: false },
      // P2 reports convergence: portal is the only reports workspace
      { source: '/admin/reports', destination: '/portal/reports', permanent: false },
      // P2 capture-sources convergence: portal is the only capture-sources workspace
      { source: '/admin/capture-sources', destination: '/portal/capture-sources', permanent: false },
      { source: '/admin/capture-sources/:path*', destination: '/portal/capture-sources', permanent: false },
      // P2 documents convergence: portal is the only documents workspace
      { source: '/admin/documents', destination: '/portal/documents', permanent: false },
      { source: '/admin/documents/new', destination: '/portal/documents/new', permanent: false },
      { source: '/admin/documents/:id/preview', destination: '/portal/documents/:id', permanent: false },
      { source: '/admin/documents/:path*', destination: '/portal/documents/:path*', permanent: false },
      // P2 geo-seo convergence: portal is the only geo-seo workspace
      { source: '/admin/geo-seo', destination: '/portal/geo-seo', permanent: false },
      { source: '/admin/geo-seo/:path*', destination: '/portal/geo-seo/:path*', permanent: false },
      // P2 marketing convergence: portal is the only marketing workspace
      { source: '/admin/marketing', destination: '/portal/marketing', permanent: false },
      { source: '/admin/marketing/:path*', destination: '/portal/marketing/:path*', permanent: false },
      // P2 briefings convergence: portal is the only briefings workspace
      { source: '/admin/briefings', destination: '/portal/briefings', permanent: false },
      { source: '/admin/briefings/:path*', destination: '/portal/briefings/:path*', permanent: false },
      // P2 email cluster convergence: portal is the only email workspace
      { source: '/admin/email/inbound', destination: '/portal/email/inbound', permanent: false },
      // P2 email-analytics convergence
      { source: '/admin/email-analytics', destination: '/portal/email-analytics', permanent: false },
      { source: '/admin/email-analytics/:path*', destination: '/portal/email-analytics/:path*', permanent: false },
      // P2 email-preferences convergence
      { source: '/admin/email-preferences', destination: '/portal/email-preferences', permanent: false },
      { source: '/admin/email-preferences/:path*', destination: '/portal/email-preferences/:path*', permanent: false },
      // P2 email-templates convergence
      { source: '/admin/email-templates', destination: '/portal/email-templates', permanent: false },
      { source: '/admin/email-templates/:path*', destination: '/portal/email-templates/:path*', permanent: false },
      // P2 sequences convergence
      { source: '/admin/sequences', destination: '/portal/sequences', permanent: false },
      { source: '/admin/sequences/:path*', destination: '/portal/sequences/:path*', permanent: false },
      // P2 broadcasts convergence
      { source: '/admin/broadcasts', destination: '/portal/broadcasts', permanent: false },
      { source: '/admin/broadcasts/:path*', destination: '/portal/broadcasts/:path*', permanent: false },
      // P2 projects convergence: portal is the only projects workspace
      { source: '/admin/projects', destination: '/portal/projects', permanent: false },
      { source: '/admin/projects/:projectId', destination: '/portal/projects/:projectId', permanent: false },
      // P2 seo convergence: portal is the only seo workspace
      { source: '/admin/seo', destination: '/portal/seo', permanent: false },
      { source: '/admin/seo/:path*', destination: '/portal/seo/:path*', permanent: false },
      // P2 social convergence: portal is the only social workspace
      { source: '/admin/social/qa/:id', destination: '/portal/social/review/:id', permanent: false },
      { source: '/admin/social/qa', destination: '/portal/social/review', permanent: false },
      { source: '/admin/social', destination: '/portal/social', permanent: false },
      { source: '/admin/social/:path*', destination: '/portal/social/:path*', permanent: false },
      // P2 campaigns convergence: portal is the only campaigns workspace
      { source: '/admin/campaigns', destination: '/portal/campaigns', permanent: false },
      { source: '/admin/campaigns/:id/blogs', destination: '/portal/campaigns/:id', permanent: false },
      { source: '/admin/campaigns/:id/brand', destination: '/portal/campaigns/:id', permanent: false },
      { source: '/admin/campaigns/:id/calendar', destination: '/portal/campaigns/:id', permanent: false },
      { source: '/admin/campaigns/:id/research', destination: '/portal/campaigns/:id', permanent: false },
      { source: '/admin/campaigns/:id/settings', destination: '/portal/campaigns/:id', permanent: false },
      { source: '/admin/campaigns/:id/social', destination: '/portal/campaigns/:id', permanent: false },
      { source: '/admin/campaigns/:id/videos', destination: '/portal/campaigns/:id', permanent: false },
      { source: '/admin/campaigns/:path*', destination: '/portal/campaigns/:path*', permanent: false },
      // P3 intelligence convergence: nav hub — all destinations now in portal
      { source: '/admin/intelligence', destination: '/portal', permanent: false },
      { source: '/admin/intelligence/:path*', destination: '/portal', permanent: false },
      // P3 finance convergence: hub redirects to portal payments
      { source: '/admin/finance', destination: '/portal/payments', permanent: false },
      { source: '/admin/finance/:path*', destination: '/portal/payments', permanent: false },
      // P3 analytics convergence: per-org analytics → portal
      { source: '/admin/analytics', destination: '/portal/analytics', permanent: false },
      // P3 invoicing convergence: portal is the only invoicing workspace
      { source: '/admin/invoicing', destination: '/portal/invoicing', permanent: false },
      { source: '/admin/invoicing/:path*', destination: '/portal/invoicing/:path*', permanent: false },
      // P3 quotes convergence: portal is the only quotes workspace
      { source: '/admin/quotes', destination: '/portal/quotes', permanent: false },
      { source: '/admin/quotes/:path*', destination: '/portal/quotes/:path*', permanent: false },

      // QA-P3: Billing path aliases — actual billing UI lives at /portal/invoicing & /portal/payments
      { source: '/portal/billing', destination: '/portal/invoicing', permanent: false },
      { source: '/portal/billing/invoices', destination: '/portal/invoicing', permanent: false },
      { source: '/portal/billing/invoices/:path*', destination: '/portal/invoicing/:path*', permanent: false },
      { source: '/portal/billing/payment-methods', destination: '/portal/payments', permanent: false },
      { source: '/portal/billing/plan', destination: '/portal/invoicing', permanent: false },
      { source: '/portal/billing/usage', destination: '/portal/invoicing', permanent: false },
      { source: '/portal/billing/:path*', destination: '/portal/invoicing', permanent: false },

      // QA-P3: Email path aliases — email features live at /portal/campaigns, /portal/email-templates, etc.
      { source: '/portal/email/campaigns', destination: '/portal/campaigns', permanent: false },
      { source: '/portal/email/campaigns/:id/design', destination: '/portal/campaigns/email/:id/edit', permanent: false },
      { source: '/portal/email/campaigns/:id/schedule', destination: '/portal/campaigns/email/:id/edit', permanent: false },
      { source: '/portal/email/campaigns/:id/analytics', destination: '/portal/campaigns/email/:id/analytics', permanent: false },
      { source: '/portal/email/campaigns/:id/test-send', destination: '/portal/campaigns/email/:id', permanent: false },
      { source: '/portal/email/campaigns/:id/:path*', destination: '/portal/campaigns/email/:id', permanent: false },
      { source: '/portal/email/campaigns/:id', destination: '/portal/campaigns/email/:id', permanent: false },
      { source: '/portal/email/campaigns/new', destination: '/portal/campaigns', permanent: false },
      { source: '/portal/email/templates', destination: '/portal/email-templates', permanent: false },
      { source: '/portal/email/templates/:path*', destination: '/portal/email-templates/:path*', permanent: false },
      { source: '/portal/email/settings/domains', destination: '/portal/email-domains', permanent: false },
      { source: '/portal/email/automations', destination: '/portal/settings/automations', permanent: false },
      { source: '/portal/email/settings/unsubscribe-page', destination: '/portal/email-preferences', permanent: false },
      { source: '/portal/email/deliverability', destination: '/portal/email-deliverability', permanent: false },
      { source: '/portal/email/list-health', destination: '/portal/email-list-health', permanent: false },

      // QA-P3: Portal settings path aliases — British vs American spelling + path moves
      { source: '/portal/settings/organisation', destination: '/portal/settings/organization', permanent: false },
      { source: '/portal/settings/branding', destination: '/portal/branding', permanent: false },
      { source: '/portal/settings/roles', destination: '/portal/settings/permissions', permanent: false },
      { source: '/portal/settings/integrations', destination: '/portal/integrations', permanent: false },

      // QA-P3: Onboarding alias
      { source: '/portal/onboarding', destination: '/portal/first-run', permanent: false },

      // QA-P3b: CRM namespace aliases — features live at top-level portal paths
      { source: '/portal/crm/contacts', destination: '/portal/contacts', permanent: false },
      { source: '/portal/crm/contacts/:path*', destination: '/portal/contacts/:path*', permanent: false },
      { source: '/portal/crm/capture-sources', destination: '/portal/capture-sources', permanent: false },
      { source: '/portal/crm/capture-sources/:path*', destination: '/portal/capture-sources/:path*', permanent: false },
      { source: '/portal/crm/pipeline', destination: '/portal/deals', permanent: false },
      { source: '/portal/crm/pipeline/:path*', destination: '/portal/deals/:path*', permanent: false },
      { source: '/portal/crm/segments', destination: '/portal/segments', permanent: false },
      { source: '/portal/crm/segments/:path*', destination: '/portal/segments/:path*', permanent: false },
      { source: '/portal/crm/integrations', destination: '/portal/integrations', permanent: false },
      { source: '/portal/crm/integrations/:path*', destination: '/portal/integrations/:path*', permanent: false },
      { source: '/portal/crm/workflows', destination: '/portal/settings/automations', permanent: false },
      { source: '/portal/crm/workflows/:path*', destination: '/portal/settings/automations', permanent: false },
      { source: '/portal/crm/settings/fields', destination: '/portal/settings/custom-fields', permanent: false },
      { source: '/portal/crm/settings/lead-scoring', destination: '/portal/settings/scoring', permanent: false },
      { source: '/portal/crm/settings/:path*', destination: '/portal/settings/crm-setup', permanent: false },
      { source: '/portal/crm/suppression', destination: '/portal/suppression', permanent: false },
      { source: '/portal/crm/tags', destination: '/portal/tags', permanent: false },

      // QA-P3b: Social namespace aliases — map to closest existing social routes
      { source: '/portal/social/generate', destination: '/portal/social/compose', permanent: false },
      { source: '/portal/social/reports', destination: '/portal/social/analytics', permanent: false },
      { source: '/portal/social/creative-canvas', destination: '/portal/creative-canvas', permanent: false },
      { source: '/portal/social/drafts', destination: '/portal/social/queue', permanent: false },
      { source: '/portal/social/campaigns', destination: '/portal/campaigns', permanent: false },
      { source: '/portal/social/campaigns/:path*', destination: '/portal/campaigns/:path*', permanent: false },
      { source: '/portal/social/hashtags', destination: '/portal/social/compose', permanent: false },

      // QA-P3b: Portal settings security alias
      { source: '/portal/settings/2fa', destination: '/portal/settings/account', permanent: false },

      // QA-P3b: SEO sub-page aliases — map to /portal/seo (sprint overview)

      // QA-P3: Admin spelling aliases — British 'organisations' → American 'organizations'
      { source: '/admin/organisations/new', destination: '/admin/organizations/new', permanent: false },
      { source: '/admin/organisations', destination: '/admin/organizations', permanent: false },
      // US-260/294/296/315/321/323/324: /admin/organisations/:orgId → /admin/org/:orgId (actual implementation path)
      { source: '/admin/organisations/:orgId', destination: '/admin/org/:orgId', permanent: false },
      { source: '/admin/organisations/:orgId/:path*', destination: '/admin/org/:orgId/:path*', permanent: false },
      { source: '/admin/organisations/:path*', destination: '/admin/organizations/:path*', permanent: false },
      // Admin users — removed redirect so /admin/users resolves to users management page
      // /admin/platform-users still works directly as its own page

      // QA-P3c: Admin section aliases for surfaces that intentionally consolidate elsewhere.
      { source: '/admin/hermes', destination: '/admin/agents', permanent: false },
      { source: '/admin/hermes/:path*', destination: '/admin/agents', permanent: false },
      { source: '/admin/broadcast', destination: '/admin/email/broadcast', permanent: false },
      { source: '/admin/products', destination: '/admin/settings', permanent: false },
      { source: '/admin/system/social-apis', destination: '/admin/settings', permanent: false },
      { source: '/admin/system/wiki-sync', destination: '/admin/mission-control', permanent: false },

      // QA-P3c: Portal — unbuilt settings pages redirect to nearest settings hub
      { source: '/portal/referrals', destination: '/portal/dashboard', permanent: false },
    ]
  },
}

export default nextConfig
