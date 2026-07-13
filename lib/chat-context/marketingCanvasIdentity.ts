const PREFIX = 'marketing_studio'

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decode(value: string): string | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    return decoded && encode(decoded) === value ? decoded : null
  } catch {
    return null
  }
}

export function marketingCanvasContextId(orgId: string, canvasId: string): string {
  return `${PREFIX}:org:${encode(orgId)}:canvas:${encode(canvasId)}`
}

export type MarketingCanvasIdentity = { orgId?: string; canvasId: string; canonical: boolean }

export function parseMarketingCanvasContextId(id: string): MarketingCanvasIdentity | null {
  const parts = id.split(':')
  if (parts.length === 5 && parts[0] === PREFIX && parts[1] === 'org' && parts[3] === 'canvas') {
    const orgId = decode(parts[2])
    const canvasId = decode(parts[4])
    return orgId && canvasId ? { orgId, canvasId, canonical: true } : null
  }
  if (parts.length !== 3 || parts[0] !== PREFIX || parts[1] !== 'canvas') return null
  try {
    const canvasId = decodeURIComponent(parts[2])
    return canvasId ? { canvasId, canonical: false } : null
  } catch {
    return null
  }
}
