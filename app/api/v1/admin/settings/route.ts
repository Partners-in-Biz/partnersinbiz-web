// app/api/v1/admin/settings/route.ts
// Platform-wide configuration (single doc platform_config/settings).
// GET (admin) returns settings with sane defaults; PUT (super-admin) validates
// and persists, writing an audit snapshot to platform_config/settings/history.
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { serializeGovernance, cleanStr, cleanBool, cleanNum, actorOf } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

interface PlatformSettings {
  platformName: string
  senderName: string
  supportEmail: string
  marketingUrl: string
  appUrl: string
  maxUploadMb: number
  allowedFileTypes: string[]
  apiRateLimitPerMin: number
  maintenanceMode: boolean
  betaFeaturesEnabled: boolean
}

const DEFAULTS: PlatformSettings = {
  platformName: 'Partners in Biz',
  senderName: 'Partners in Biz',
  supportEmail: 'support@partnersinbiz.online',
  marketingUrl: 'https://partnersinbiz.online',
  appUrl: 'https://partnersinbiz.online',
  maxUploadMb: 25,
  allowedFileTypes: ['png', 'jpg', 'jpeg', 'pdf', 'csv', 'mp4'],
  apiRateLimitPerMin: 120,
  maintenanceMode: false,
  betaFeaturesEnabled: false,
}

const SETTINGS_REF = () => adminDb.collection('platform_config').doc('settings')

function parseFileTypes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => cleanStr(v, 32).toLowerCase().replace(/^\./, '')).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean)
  }
  return DEFAULTS.allowedFileTypes
}

export const GET = withAuth('admin', async () => {
  try {
    const snap = await SETTINGS_REF().get()
    if (!snap.exists) return apiSuccess(serializeGovernance({ ...DEFAULTS }))
    const data = snap.data() ?? {}
    const merged: Record<string, unknown> = {
      ...DEFAULTS,
      ...data,
      allowedFileTypes: parseFileTypes(data.allowedFileTypes ?? DEFAULTS.allowedFileTypes),
    }
    return apiSuccess(serializeGovernance(merged))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PUT = withAuth('admin', async (req, user) => {
  if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
  try {
    const raw = await req.json().catch(() => ({}))

    const settings: PlatformSettings = {
      platformName: cleanStr(raw.platformName, 200) || DEFAULTS.platformName,
      senderName: cleanStr(raw.senderName, 200) || DEFAULTS.senderName,
      supportEmail: cleanStr(raw.supportEmail, 200),
      marketingUrl: cleanStr(raw.marketingUrl, 500),
      appUrl: cleanStr(raw.appUrl, 500),
      maxUploadMb: Math.max(1, Math.min(1024, cleanNum(raw.maxUploadMb, DEFAULTS.maxUploadMb))),
      allowedFileTypes: parseFileTypes(raw.allowedFileTypes),
      apiRateLimitPerMin: Math.max(1, Math.min(100000, cleanNum(raw.apiRateLimitPerMin, DEFAULTS.apiRateLimitPerMin))),
      // maintenanceMode is read-only here: the real toggle lives on the
      // maintenance page (platform_config/maintenance). We mirror current value.
      maintenanceMode: DEFAULTS.maintenanceMode,
      betaFeaturesEnabled: cleanBool(raw.betaFeaturesEnabled, DEFAULTS.betaFeaturesEnabled),
    }

    if (settings.supportEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(settings.supportEmail)) {
      return apiError('Invalid support email', 400)
    }

    // Preserve the mirrored maintenanceMode from the maintenance doc.
    try {
      const maintSnap = await adminDb.collection('platform_config').doc('maintenance').get()
      if (maintSnap.exists) settings.maintenanceMode = maintSnap.data()?.enabled === true
    } catch {
      /* ignore — mirror best-effort */
    }

    const actor = actorOf(user)
    const record = {
      ...settings,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor,
    }

    await SETTINGS_REF().set(record, { merge: true })
    await SETTINGS_REF().collection('history').add({
      snapshot: settings,
      actor,
      at: FieldValue.serverTimestamp(),
    })

    const fresh = await SETTINGS_REF().get()
    return apiSuccess(serializeGovernance(fresh.data() ?? settings))
  } catch (err) {
    return apiErrorFromException(err)
  }
})
