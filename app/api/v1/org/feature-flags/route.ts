import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'

export const dynamic = 'force-dynamic'

export interface OrgFeatureFlags {
  show_ai_features: boolean
  show_creative_canvas: boolean
  enable_social_listening: boolean
  show_whatsapp: boolean
}

export const DEFAULT_FEATURE_FLAGS: OrgFeatureFlags = {
  show_ai_features: true,
  show_creative_canvas: true,
  enable_social_listening: false,
  show_whatsapp: false,
}

function coerceFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export function resolveFeatureFlags(raw: unknown): OrgFeatureFlags {
  const flags = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    show_ai_features: coerceFlag(flags.show_ai_features, DEFAULT_FEATURE_FLAGS.show_ai_features),
    show_creative_canvas: coerceFlag(flags.show_creative_canvas, DEFAULT_FEATURE_FLAGS.show_creative_canvas),
    enable_social_listening: coerceFlag(flags.enable_social_listening, DEFAULT_FEATURE_FLAGS.enable_social_listening),
    show_whatsapp: coerceFlag(flags.show_whatsapp, DEFAULT_FEATURE_FLAGS.show_whatsapp),
  }
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid, orgId) => {
  try {
    const snap = await adminDb.collection('organizations').doc(orgId).get()
    if (!snap.exists) return apiError('Organisation not found', 404)
    const settings = snap.data()?.settings as { featureFlags?: unknown } | undefined
    const flags = resolveFeatureFlags(settings?.featureFlags)
    return apiSuccess({ orgId, flags })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
