import path from 'path'

const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
  transpilePackages: ['@partnersinbiz/analytics-js'],
  serverExternalPackages: ['@react-pdf/renderer'],
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
      { source: '/admin/documents/new', destination: '/portal/documents', permanent: false },
      { source: '/admin/documents/:id/preview', destination: '/portal/documents/:id', permanent: false },
      { source: '/admin/documents/:path*', destination: '/portal/documents/:path*', permanent: false },
      // P2 properties convergence: portal is the only properties workspace
      { source: '/admin/properties', destination: '/portal/properties', permanent: false },
      { source: '/admin/properties/new', destination: '/portal/properties/new', permanent: false },
      { source: '/admin/properties/:id/connections', destination: '/portal/properties/:id/connections', permanent: false },
      { source: '/admin/properties/:path*', destination: '/portal/properties/:path*', permanent: false },
      // P2 email cluster convergence: portal is the only email workspace
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
    ]
  },
}

export default nextConfig
