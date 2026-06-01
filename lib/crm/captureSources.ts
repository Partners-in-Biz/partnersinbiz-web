// lib/crm/captureSources.ts
//
// A CaptureSource is a way contacts flow INTO an org's CRM:
//   - 'form'        — embeddable widget on a client's site
//   - 'api'         — public POST endpoint (Zapier / n8n / custom)
//   - 'csv'         — bulk imports (one source per import batch is overkill;
//                     use a single per-org system source with type='csv')
//   - 'integration' — Mailchimp / HubSpot / Gmail sync (Phase 4)
//   - 'manual'      — operator/client typed the contact in by hand
//
// Each source has a `publicKey` used to authenticate public POSTs to
// `/api/public/capture/[publicKey]`. The key is opaque (random bytes) so
// rotating the key effectively kills any forms / integrations using it.

import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export type CaptureSourceType = 'form' | 'api' | 'csv' | 'integration' | 'manual'

export interface CaptureSource {
  id: string
  orgId: string
  name: string
  type: CaptureSourceType
  publicKey: string                  // opaque ingest key (32 hex chars)
  enabled: boolean

  // Behavior on capture
  autoTags: string[]                 // tags applied to every captured contact
  autoCampaignIds: string[]          // campaigns to auto-enroll on capture
  autoSequenceIds: string[]          // direct sequences to auto-enroll on capture
  redirectUrl: string                // form widget redirects here on success
  consentRequired: boolean           // require explicit checkbox in form widget

  // Rolling counters (eventual consistency — incremented best-effort)
  capturedCount: number
  lastCapturedAt: Timestamp | null

  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  createdBy?: string
  createdByRef?: MemberRef
  updatedBy?: string
  updatedByRef?: MemberRef
  deleted?: boolean
}

export type CaptureSourceInput = Pick<
  CaptureSource,
  'orgId' | 'name' | 'type'
> & Partial<Omit<CaptureSource, 'id' | 'publicKey' | 'capturedCount' | 'lastCapturedAt' | 'createdAt' | 'updatedAt'>>

// Generate an opaque, URL-safe ingest key.
// Pure crypto.randomBytes — no PII, no collision risk in practice (16 bytes
// = 128 bits of entropy).
export function generatePublicKey(): string {
  // Web Crypto is available in Edge runtime; fall back to node:crypto on Node.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as { randomBytes: (n: number) => Buffer }
  return nodeCrypto.randomBytes(16).toString('hex')
}

// Subset returned to the public form widget — never includes orgId or
// internal flags. Used by /embed/form/[publicKey] to render the form.
export interface PublicCaptureSourceView {
  publicKey: string
  name: string
  consentRequired: boolean
  redirectUrl: string
}
