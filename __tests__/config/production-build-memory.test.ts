import nextConfig from '@/next.config'
import packageJson from '@/package.json'

describe('production build memory profile', () => {
  it('isolates webpack and bounds page-generation concurrency for Vercel builds', () => {
    expect(nextConfig.experimental).toMatchObject({
      webpackBuildWorker: true,
      webpackMemoryOptimizations: true,
      cpus: 1,
      staticGenerationMaxConcurrency: 2,
    })
  })

  it('leaves headroom outside the Node heap on an 8 GB build machine', () => {
    expect(packageJson.scripts.build).toContain('NODE_OPTIONS=--max-old-space-size=6144 next build')
  })
})
