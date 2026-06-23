// app/api/v1/org/roles/route.ts
//
// Role x feature permission matrix for an organisation (US-198).
//
// GET -> the org's role-feature matrix (from organizations.{orgId}.settings.roleMatrix),
//        defaulting to a sensible default matrix when unset.
// PUT -> (owner only) validate and persist the matrix.
//
// Roles presented in the matrix map to the platform's editable roles:
//   admin  (Admin)  -> full access by default
//   member (Editor) -> operational features on, Billing/Settings off by default
//   viewer (Viewer) -> read-only feature visibility (CRM/Analytics/Documents) on
// The platform `owner` role is implicitly all-access and is NOT part of the editable
// matrix (owners always have every feature) — it is returned as a locked-on row so
// the UI can render it, but it is never persisted or editable.

import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess, apiErrorFromException } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

// Feature keys (matrix columns).
export const FEATURE_KEYS = [
  'crm',
  'social',
  'email',
  'seo',
  'analytics',
  'billing',
  'documents',
  'settings',
] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

// Editable roles (matrix rows). `owner` is implicit all-access and not stored.
export const MATRIX_ROLES = ['admin', 'member', 'viewer'] as const
export type MatrixRole = (typeof MATRIX_ROLES)[number]

export type RoleMatrix = Record<MatrixRole, Record<FeatureKey, boolean>>

function allOn(): Record<FeatureKey, boolean> {
  return FEATURE_KEYS.reduce((acc, key) => {
    acc[key] = true
    return acc
  }, {} as Record<FeatureKey, boolean>)
}

function fromKeys(onKeys: FeatureKey[]): Record<FeatureKey, boolean> {
  return FEATURE_KEYS.reduce((acc, key) => {
    acc[key] = onKeys.includes(key)
    return acc
  }, {} as Record<FeatureKey, boolean>)
}

// The default matrix used when an org has never configured roleMatrix.
export function defaultRoleMatrix(): RoleMatrix {
  return {
    admin: allOn(),
    member: fromKeys(['crm', 'social', 'email', 'seo', 'analytics', 'documents']),
    viewer: fromKeys(['crm', 'analytics', 'documents']),
  }
}

// Coerce a stored/raw value into a complete, well-typed matrix, falling back to
// defaults for any missing role or feature so the response is always exhaustive.
function normaliseMatrix(raw: unknown): RoleMatrix {
  const defaults = defaultRoleMatrix()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults

  const source = raw as Record<string, unknown>
  const result = {} as RoleMatrix

  for (const role of MATRIX_ROLES) {
    const stored = source[role]
    const roleRow = stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {}
    const row = {} as Record<FeatureKey, boolean>
    for (const feature of FEATURE_KEYS) {
      row[feature] = typeof roleRow[feature] === 'boolean'
        ? (roleRow[feature] as boolean)
        : defaults[role][feature]
    }
    result[role] = row
  }

  return result
}

// The owner row is always fully on and locked — surfaced for UI rendering only.
function ownerRow(): Record<FeatureKey, boolean> {
  return allOn()
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string) => {
  try {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    const stored = orgDoc.exists ? (orgDoc.data()?.settings as Record<string, unknown> | undefined)?.roleMatrix : undefined
    const matrix = normaliseMatrix(stored)

    return apiSuccess({
      matrix,
      owner: ownerRow(),
      features: FEATURE_KEYS,
      roles: MATRIX_ROLES,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PUT = withPortalAuthAndRole('owner', async (req: NextRequest, _uid: string, orgId: string) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const rawMatrix = body.matrix

    if (!rawMatrix || typeof rawMatrix !== 'object' || Array.isArray(rawMatrix)) {
      return apiError('A role matrix object is required', 400)
    }

    // Validate that every provided role/feature value is boolean; unknown keys are
    // dropped and missing keys fall back to defaults via normaliseMatrix.
    const source = rawMatrix as Record<string, unknown>
    for (const role of MATRIX_ROLES) {
      const row = source[role]
      if (row === undefined) continue
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        return apiError(`Role "${role}" must be an object of feature toggles`, 400)
      }
      for (const [feature, value] of Object.entries(row as Record<string, unknown>)) {
        if (FEATURE_KEYS.includes(feature as FeatureKey) && typeof value !== 'boolean') {
          return apiError(`Feature "${feature}" for role "${role}" must be a boolean`, 400)
        }
      }
    }

    const matrix = normaliseMatrix(rawMatrix)

    // Dot-path write so we never clobber sibling settings keys.
    await adminDb.collection('organizations').doc(orgId).update({
      'settings.roleMatrix': matrix,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return apiSuccess({
      matrix,
      owner: ownerRow(),
      features: FEATURE_KEYS,
      roles: MATRIX_ROLES,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
