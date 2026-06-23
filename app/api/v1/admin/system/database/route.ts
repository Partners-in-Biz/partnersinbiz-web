// app/api/v1/admin/system/database/route.ts
//
// US-275 — Firestore collection viewer.
// GET (admin) -> lists real top-level collections with fast counts.

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req: NextRequest) => {
  try {
    const colRefs = await adminDb.listCollections()
    const collections = await Promise.all(
      colRefs.map(async (colRef) => {
        let count = 0
        try {
          const snap = await colRef.count().get()
          count = snap.data().count
        } catch {
          count = -1 // count unavailable for this collection
        }
        return { name: colRef.id, count }
      }),
    )
    collections.sort((a, b) => a.name.localeCompare(b.name))
    return apiSuccess({ collections })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
