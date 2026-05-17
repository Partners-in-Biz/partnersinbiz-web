// app/api/v1/crm/companies/migrate-from-contacts/route.ts
// POST — admin-only migration tool: preview contacts grouped by company string,
// then apply to create Company entities and link contacts.

import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  groupContactsByCompanyKey,
  applyMigration,
} from '@/lib/companies/migration'
import type { Contact } from '@/lib/crm/types'
import type { MigrationSelection } from '@/lib/companies/migration'

export const POST = withCrmAuth('admin', async (req, ctx) => {
  // Parse body — fall back to empty object on malformed JSON
  const body = await req.json().catch(() => ({})) as {
    mode?: string
    selections?: Array<{
      normalizedKey: string
      companyName: string
      useExistingCompanyId?: string
    }>
  }

  const mode = body?.mode ?? 'preview'

  // Load all contacts for this org (capped at 5000; B2B orgs grow slowly)
  const contactsSnap = await adminDb
    .collection('contacts')
    .where('orgId', '==', ctx.orgId)
    .limit(5000)
    .get()

  const contacts: Contact[] = contactsSnap.docs.map(d => ({
    id: d.id,
    ...(d.data() as Omit<Contact, 'id'>),
  }))

  // Group by normalized company key (skips already-linked + empty)
  const groups = groupContactsByCompanyKey(contacts)

  // Resolve existingCompanyId for each group via name lookup
  for (const g of groups) {
    const existingSnap = await adminDb
      .collection('companies')
      .where('orgId', '==', ctx.orgId)
      .where('name', '==', g.suggestedCompanyName)
      .limit(1)
      .get()

    if (!existingSnap.empty) {
      g.existingCompanyId = existingSnap.docs[0].id
    }
  }

  // ── Preview mode ──────────────────────────────────────────────────────────
  if (mode === 'preview') {
    return apiSuccess({ matches: groups })
  }

  // ── Apply mode ────────────────────────────────────────────────────────────
  if (mode === 'apply') {
    const rawSelections = body?.selections
    if (!Array.isArray(rawSelections) || rawSelections.length === 0) {
      return apiError('selections required', 400)
    }

    // Resolve each selection against the groups computed above
    const resolved: MigrationSelection[] = rawSelections
      .map(sel => {
        const group = groups.find(g => g.normalizedKey === sel.normalizedKey)
        return {
          normalizedKey: sel.normalizedKey,
          companyName: sel.companyName,
          useExistingCompanyId:
            sel.useExistingCompanyId ?? group?.existingCompanyId ?? undefined,
          // Only include contact IDs that still appear in the group
          // (already-linked contacts have been filtered out by groupContactsByCompanyKey)
          applyToContactIds: group?.contactIds ?? [],
        }
      })
      // Keep selections with at least one contact to update
      .filter(s => s.applyToContactIds.length > 0 || s.useExistingCompanyId !== undefined)

    const results = await applyMigration(ctx.orgId, resolved, ctx.actor)
    return apiSuccess({ results })
  }

  return apiError('Invalid mode', 400)
})
