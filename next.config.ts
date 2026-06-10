import path from 'path'

const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  turbopack: {
    root: path.resolve(process.cwd()),
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
    ]
  },
}

export default nextConfig
