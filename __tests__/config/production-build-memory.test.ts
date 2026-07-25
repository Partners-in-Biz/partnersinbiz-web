import path from 'path'
import nextConfig from '@/next.config'
import packageJson from '@/package.json'

describe('production build memory profile', () => {
  it('runs webpack in-process and bounds page-generation concurrency for Vercel builds', () => {
    expect(nextConfig.experimental).toMatchObject({
      webpackBuildWorker: false,
      webpackMemoryOptimizations: true,
      cpus: 1,
      staticGenerationMaxConcurrency: 1,
    })
    expect(nextConfig.productionBrowserSourceMaps).toBe(false)
  })

  it('keeps turbopack.root aligned with outputFileTracingRoot at the app root', () => {
    const projectRoot = path.join(__dirname, '../..')
    expect(nextConfig.outputFileTracingRoot).toBe(projectRoot)
    expect(nextConfig.turbopack?.root).toBe(projectRoot)
  })

  it('leaves headroom outside the Node heap on an 8 GB build machine', () => {
    expect(packageJson.scripts.build).toContain('NODE_OPTIONS=--max-old-space-size=6144 next build')
  })
})
