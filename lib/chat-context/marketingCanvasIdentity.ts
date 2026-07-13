import { parseStudioArtifactContextId, studioArtifactContextId } from './studioArtifactIdentity'

const PREFIX = 'marketing_studio'

export function marketingCanvasContextId(orgId: string, canvasId: string): string {
  return studioArtifactContextId({ studioKind: PREFIX, orgId, resourceType: 'canvas', resourceId: canvasId })
}

export type MarketingCanvasIdentity = { orgId?: string; canvasId: string; canonical: boolean }

export function parseMarketingCanvasContextId(id: string): MarketingCanvasIdentity | null {
  const canonical = parseStudioArtifactContextId(id)
  if (canonical?.studioKind === PREFIX && canonical.resourceType === 'canvas') return { orgId: canonical.orgId, canvasId: canonical.resourceId, canonical: true }
  const parts = id.split(':')
  if (parts.length !== 3 || parts[0] !== PREFIX || parts[1] !== 'canvas') return null
  try {
    const canvasId = decodeURIComponent(parts[2])
    return canvasId ? { canvasId, canonical: false } : null
  } catch {
    return null
  }
}
