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
    ]
  },
}

export default nextConfig
