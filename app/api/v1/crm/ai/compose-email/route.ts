// app/api/v1/crm/ai/compose-email/route.ts
//
// POST /api/v1/crm/ai/compose-email
// Generates a short personalised sales email for a contact using an LLM.
// Auth: member+

import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { apiSuccess, apiError } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { BRIEF_MODEL } from '@/lib/ai/client'

export const dynamic = 'force-dynamic'

async function handler(req: NextRequest, ctx: CrmAuthContext): Promise<Response> {
  const { orgId } = ctx

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const { contactId, purpose, tone = 'professional' } = body as {
    contactId?: string
    purpose?: string
    tone?: string
  }

  if (!contactId) return apiError('contactId is required', 400)
  if (!purpose) return apiError('purpose is required', 400)

  // ── Fetch contact ────────────────────────────────────────────────────────────
  const contactSnap = await adminDb.collection('contacts').doc(contactId as string).get()
  if (!contactSnap.exists) return apiError('Contact not found', 404)

  const contact = contactSnap.data() as {
    orgId?: string
    name?: string
    company?: string
    stage?: string
    leadScore?: number
  }
  if (contact.orgId !== orgId) return apiError('Contact not found', 404)

  // ── Generate email ───────────────────────────────────────────────────────────
  try {
    const { text } = await generateText({
      model: BRIEF_MODEL,
      prompt: `Write a short, personalised sales email. Return ONLY valid JSON with keys "subject" and "bodyText" (plain text, no HTML).
Contact name: ${contact.name ?? 'there'}
Company: ${contact.company ?? 'their company'}
Stage: ${contact.stage ?? 'unknown'}
Lead score: ${contact.leadScore ?? 'N/A'}
Purpose: ${purpose}
Tone: ${tone}`,
    })

    // ── Parse JSON output ────────────────────────────────────────────────────
    let subject: string
    let bodyText: string

    try {
      const parsed = JSON.parse(text)
      subject = parsed.subject
      bodyText = parsed.bodyText
    } catch {
      // Fallback: regex extraction if model wrapped JSON in markdown or added text
      const subjectMatch = text.match(/"subject"\s*:\s*"([^"]+)"/)
      const bodyMatch = text.match(/"bodyText"\s*:\s*"([\s\S]+?)"(?:\s*[},])/)
      if (subjectMatch && bodyMatch) {
        subject = subjectMatch[1]
        bodyText = bodyMatch[1].replace(/\\n/g, '\n')
      } else {
        return apiError('AI composition failed', 500)
      }
    }

    if (!subject || !bodyText) return apiError('AI composition failed', 500)

    return apiSuccess({ subject, bodyText })
  } catch {
    return apiError('AI composition failed', 500)
  }
}

export const POST = withCrmAuth('member', handler)
