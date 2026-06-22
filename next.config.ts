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
      { source: '/admin/reports/:path*', destination: '/portal/reports/:path*', permanent: false },
      // P2 capture-sources convergence: portal is the only capture-sources workspace
      { source: '/admin/capture-sources', destination: '/portal/capture-sources', permanent: false },
      { source: '/admin/capture-sources/:path*', destination: '/portal/capture-sources', permanent: false },
      // P2 documents convergence: portal is the only documents workspace
      { source: '/admin/documents', destination: '/portal/documents', permanent: false },
      { source: '/admin/documents/new', destination: '/portal/documents/new', permanent: false },
      { source: '/admin/documents/:id/preview', destination: '/portal/documents/:id', permanent: false },
      { source: '/admin/documents/:path*', destination: '/portal/documents/:path*', permanent: false },
      // P2 properties convergence: portal is the only properties workspace
      { source: '/admin/properties', destination: '/portal/properties', permanent: false },
      { source: '/admin/properties/new', destination: '/portal/properties/new', permanent: false },
      { source: '/admin/properties/:id/connections', destination: '/portal/properties/:id/connections', permanent: false },
      { source: '/admin/properties/:path*', destination: '/portal/properties/:path*', permanent: false },
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
      { source: '/admin/email', destination: '/portal/email', permanent: false },
      { source: '/admin/email/:path*', destination: '/portal/email', permanent: false },
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
      { source: '/admin/analytics/:path*', destination: '/portal/analytics/:path*', permanent: false },
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
      { source: '/portal/email/campaigns/:path*', destination: '/portal/campaigns/:path*', permanent: false },
      { source: '/portal/email/templates', destination: '/portal/email-templates', permanent: false },
      { source: '/portal/email/templates/:path*', destination: '/portal/email-templates/:path*', permanent: false },
      { source: '/portal/email/settings/domains', destination: '/portal/email-domains', permanent: false },
      { source: '/portal/email/automations', destination: '/portal/settings/automations', permanent: false },
      { source: '/portal/email/settings/unsubscribe-page', destination: '/portal/email-preferences', permanent: false },
      { source: '/portal/email/deliverability', destination: '/portal/email-analytics', permanent: false },
      { source: '/portal/email/list-health', destination: '/portal/email-analytics', permanent: false },

      // QA-P3: Analytics path aliases
      { source: '/portal/analytics/realtime', destination: '/portal/analytics/live', permanent: false },

      // QA-P3: Portal settings path aliases — British vs American spelling + path moves
      { source: '/portal/settings/organisation', destination: '/portal/settings/organization', permanent: false },
      { source: '/portal/settings/branding', destination: '/portal/branding', permanent: false },
      { source: '/portal/settings/roles', destination: '/portal/settings/permissions', permanent: false },
      { source: '/portal/settings/integrations', destination: '/portal/integrations', permanent: false },

      // QA-P3: Onboarding alias
      { source: '/portal/onboarding', destination: '/portal/first-run', permanent: false },

      // QA-P3: Admin spelling aliases — British 'organisations' → American 'organizations'
      { source: '/admin/organisations', destination: '/admin/organizations', permanent: false },
      { source: '/admin/organisations/:path*', destination: '/admin/organizations/:path*', permanent: false },
      // Admin users alias
      { source: '/admin/users', destination: '/admin/platform-users', permanent: false },
      { source: '/admin/users/:path*', destination: '/admin/platform-users/:path*', permanent: false },
    ]
  },
}

export default nextConfig
