/**
 * POST /api/v1/email/campaigns/[id]/preview-renders  (US-138)
 *
 * Multi-client inbox preview. Renders the campaign's stored email document to
 * HTML once, then wraps that HTML in deterministic, client-specific CSS-reset
 * variants that approximate how the major email clients render it:
 *
 *   - gmail        — strips <style> from <head> (Gmail historically did this
 *                    for the head; modern Gmail keeps embedded styles but its
 *                    classic behaviour and the Gmail app still differ), forces
 *                    Roboto/Arial, applies Gmail's own body reset.
 *   - outlook      — emulates Word/MSO rendering: no max-width on the body
 *                    wrapper, no border-radius, no box-shadow, no background
 *                    images, fixed 1.5 line-height — the classic Outlook
 *                    desktop issues. Flags are returned per client.
 *   - apple_mail   — closest to a standards-compliant render; honours
 *                    prefers-color-scheme and rounded corners.
 *   - mobile       — narrow 380px viewport with the client's mobile reset.
 *
 * These are real CSS-reset variants of the SAME rendered HTML — not fake
 * screenshots. The caller renders each in its own iframe behind a per-client
 * tab. Body accepts an optional inline { document, vars } so the editor can
 * preview unsaved edits; otherwise the persisted campaign.emailDocument is used.
 *
 * Auth: client (scoped to the campaign's org).
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { renderEmail } from '@/lib/email-builder/render'
import { validateDocument } from '@/lib/email-builder/validate'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import type { TemplateVars } from '@/lib/email/template'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

interface ClientProfile {
  id: string
  label: string
  /** Width the caller should give the preview iframe. */
  viewportWidth: number
  /** Known rendering quirks surfaced to the user. */
  issues: string[]
  /** CSS injected into the rendered email to emulate the client. */
  resetCss: string
  /** When true, strip <style> blocks from the document <head> before wrapping. */
  stripHeadStyles?: boolean
}

function sampleVars(orgName: string): TemplateVars {
  return {
    first_name: 'Alex',
    firstName: 'Alex',
    last_name: 'Morgan',
    lastName: 'Morgan',
    full_name: 'Alex Morgan',
    name: 'Alex Morgan',
    email: 'alex@example.com',
    company: 'Acme Co',
    company_name: 'Acme Co',
    orgName,
    org_name: orgName,
    unsubscribeUrl: '#unsubscribe-preview',
    preferencesUrl: '#preferences-preview',
  }
}

const CLIENTS: ClientProfile[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    viewportWidth: 640,
    issues: [
      'Gmail clips messages larger than ~102KB ("[Message clipped]").',
      'Embedded <style> in <head> is not always honoured — keep critical styles inline.',
      'Background images are stripped in some Gmail contexts.',
    ],
    // Gmail overrides the body font and removes some defaults. Approximate its
    // reset and force its default sans stack.
    resetCss: `
      html, body { background: #ffffff !important; }
      body, body * { font-family: Roboto, Arial, Helvetica, sans-serif !important; }
      a { color: #15c !important; }
    `,
  },
  {
    id: 'outlook',
    label: 'Outlook (Windows)',
    viewportWidth: 640,
    issues: [
      'Uses the Word (MSO) engine: border-radius, box-shadow and CSS background images are ignored.',
      'max-width on non-table elements is ignored — layouts can break full-width.',
      'Padding on <div>/<p> is unreliable; use table cell padding.',
      'Animated GIFs show only the first frame.',
    ],
    // Emulate the classic Outlook desktop limitations.
    resetCss: `
      * {
        border-radius: 0 !important;
        box-shadow: none !important;
        background-image: none !important;
        max-width: none !important;
      }
      body, body * {
        font-family: 'Segoe UI', Arial, sans-serif !important;
        line-height: 1.5 !important;
      }
    `,
  },
  {
    id: 'apple_mail',
    label: 'Apple Mail',
    viewportWidth: 640,
    issues: [
      'Renders close to web standards; honours prefers-color-scheme dark mode.',
      'May auto-scale text on first open ("smart" text sizing).',
    ],
    resetCss: `
      body, body * { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif !important; }
    `,
  },
  {
    id: 'mobile',
    label: 'Mobile',
    viewportWidth: 380,
    issues: [
      'Narrow viewport — single column is safest; touch targets need ~44px height.',
      'Long preheaders and subjects are truncated early.',
    ],
    resetCss: `
      body, body * { font-family: -apple-system, Roboto, Arial, sans-serif !important; }
      img { max-width: 100% !important; height: auto !important; }
    `,
  },
]

const STYLE_TAG_RE = /<style[^>]*>[\s\S]*?<\/style>/gi

/** Inject a client reset <style> (and optionally strip head styles) into rendered HTML. */
function wrapForClient(html: string, client: ClientProfile): string {
  let out = html
  if (client.stripHeadStyles) {
    // Only strip styles that live in <head>; preserve inline element styles.
    out = out.replace(/<head[^>]*>[\s\S]*?<\/head>/i, (head) => head.replace(STYLE_TAG_RE, ''))
  }
  const injected = `<style data-preview-client="${client.id}">${client.resetCss}</style>`
  if (/<\/head>/i.test(out)) {
    return out.replace(/<\/head>/i, `${injected}</head>`)
  }
  if (/<body[^>]*>/i.test(out)) {
    return out.replace(/(<body[^>]*>)/i, `$1${injected}`)
  }
  return injected + out
}

/** Heuristic warnings about the document that explain WHY a client may break. */
function documentLevelFlags(html: string): { outlook: string[]; gmail: string[] } {
  const flags = { outlook: [] as string[], gmail: [] as string[] }
  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > 102_000) {
    flags.gmail.push(`Message is ${(bytes / 1024).toFixed(0)}KB — Gmail clips above ~102KB.`)
  }
  if (/border-radius\s*:/i.test(html)) {
    flags.outlook.push('Document uses border-radius — corners will appear square in Outlook.')
  }
  if (/box-shadow\s*:/i.test(html)) {
    flags.outlook.push('Document uses box-shadow — shadows are dropped in Outlook.')
  }
  if (/background(-image)?\s*:\s*url\(/i.test(html)) {
    flags.outlook.push('Document uses CSS background images — not rendered in Outlook desktop.')
    flags.gmail.push('CSS background images may be stripped by Gmail.')
  }
  if (/max-width\s*:/i.test(html)) {
    flags.outlook.push('Document relies on max-width — ignored by Outlook on non-table elements.')
  }
  return flags
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = snap.data() as any
  const scope = resolveOrgScope(user, (campaign.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  // Allow previewing an unsaved, in-progress document from the editor.
  const body = await req.json().catch(() => null)
  const sourceDocument =
    body && typeof body === 'object' && body.document && typeof body.document === 'object'
      ? body.document
      : campaign.emailDocument

  if (!sourceDocument) {
    return apiError('Campaign has no email content yet — design the email first', 422)
  }

  const validation = validateDocument(sourceDocument)
  if (!validation.ok) {
    return apiError('Email content is invalid: ' + validation.errors.join('; '), 422)
  }

  const brandKit = await getBrandKitForOrg(orgId)
  const orgName = (campaign.fromName as string) || brandKit.brandName || 'Partners in Biz'
  const vars =
    body && typeof body === 'object' && body.vars && typeof body.vars === 'object'
      ? (body.vars as TemplateVars)
      : sampleVars(orgName)

  const { html } = renderEmail(validation.doc, vars)
  const docFlags = documentLevelFlags(html)

  const renders = CLIENTS.map((client) => {
    const clientIssues = [...client.issues]
    if (client.id === 'outlook') clientIssues.push(...docFlags.outlook)
    if (client.id === 'gmail') clientIssues.push(...docFlags.gmail)
    return {
      client: client.id,
      label: client.label,
      viewportWidth: client.viewportWidth,
      html: wrapForClient(html, client),
      issues: clientIssues,
      hasOutlookIssues: client.id === 'outlook' && docFlags.outlook.length > 0,
    }
  })

  const subject =
    (typeof campaign.subject === 'string' && campaign.subject.trim()) ||
    validation.doc.subject ||
    '(no subject)'

  return apiSuccess({
    subject,
    outlookIssueCount: docFlags.outlook.length,
    renders,
  })
})
