import { CANVAS_MODELS, getCanvasModel } from '@/lib/creative-canvas/model-registry'

describe('multi-provider models', () => {
  it.each([
    ['grok-imagine-image', 'xai', 'image', 'sync'],
    ['grok-imagine-image-quality', 'xai', 'image', 'sync'],
    ['grok-imagine-video', 'xai', 'video', 'async'],
    ['grok-imagine-video-1.5', 'xai', 'video', 'async'],
    ['gemini-3-pro-image-preview', 'google', 'image', 'sync'],
    ['imagen-4', 'google', 'image', 'sync'],
    ['recraftv4', 'recraft', 'image', 'sync'],
    ['recraftv4-vector', 'recraft', 'image', 'sync'],
    ['fal-flux-2-pro', 'fal', 'image', 'async'],
    ['fal-kling-video-2-6-pro', 'fal', 'video', 'async'],
    ['fal-veo-3-1', 'fal', 'video', 'async'],
  ])('%s belongs to %s (%s, %s)', (id, provider, kind, execution) => {
    const m = getCanvasModel(id)
    expect(m?.providerKey).toBe(provider)
    expect(m?.kind).toBe(kind)
    expect(m?.execution).toBe(execution)
  })

  it('every model id is unique', () => {
    const ids = CANVAS_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no BYOK model is marked unlimited', () => {
    const byokProviders = new Set(['xai', 'google', 'fal', 'recraft'])
    for (const m of CANVAS_MODELS.filter((m) => byokProviders.has(m.providerKey))) {
      expect(m.unlimited).toBeFalsy()
    }
  })
})
