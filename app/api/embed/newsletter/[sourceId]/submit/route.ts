// app/api/embed/newsletter/[sourceId]/submit/route.ts
//
// PUBLIC: public alias for /api/v1/capture-sources/[id]/submit. Keeps the embed
// widget URLs in a clearly "public-shaped" namespace.

import { NextRequest } from 'next/server'
import {
  POST as v1Submit,
  OPTIONS as v1Options,
} from '@/app/api/v1/capture-sources/[id]/submit/route'

type Params = { params: Promise<{ sourceId: string }> }

export async function POST(req: NextRequest, context: Params) {
  const { sourceId } = await context.params
  return v1Submit(req, { params: Promise.resolve({ id: sourceId }) })
}

export const OPTIONS = v1Options
