import { marketingCanvasContextId, parseMarketingCanvasContextId } from '@/lib/chat-context/marketingCanvasIdentity'

describe('Marketing canvas context identity', () => {
  it('round-trips opaque org and canvas ids without delimiter ambiguity', () => {
    const id = marketingCanvasContextId('org:west', 'canvas:launch')
    expect(id).toMatch(/^marketing_studio:org:[A-Za-z0-9_-]+:canvas:[A-Za-z0-9_-]+$/)
    expect(parseMarketingCanvasContextId(id)).toEqual({ orgId: 'org:west', canvasId: 'canvas:launch', canonical: true })
  })

  it('accepts a legacy encoded canvas id for migration and rejects malformed canonical ids', () => {
    expect(parseMarketingCanvasContextId('marketing_studio:canvas:canvas%3Alaunch')).toEqual({ canvasId: 'canvas:launch', canonical: false })
    expect(parseMarketingCanvasContextId('marketing_studio:org:not+padded:canvas:bad')).toBeNull()
  })
})
