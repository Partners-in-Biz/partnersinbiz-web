/**
 * Always-on Messages dynamic-chat canvas contract injected into every agent turn.
 * Keep this the single source of agent-facing canvas rules for Mac + VPS.
 */
import {
  MESSAGES_CANVAS_KINDS,
  type MessagesCanvasKind,
} from '@/lib/messages/openContextHandoff'

/** Registry: create path + human intent + anti-pattern for each dock canvas kind. */
export const MESSAGES_CANVAS_REGISTRY: Record<MessagesCanvasKind, {
  intents: string
  create: string
  never: string
  humanAction: string
}> = {
  email: {
    intents: 'put this in an email / draft an email / email someone / email preview',
    create: 'POST /api/v1/agent/email/drafts (or /replies) with to, subject, bodyText',
    never: 'Never paste a full email body as chat-only “preview” text',
    humanAction: 'Humans edit in the email canvas and Approve & send — never auto-send',
  },
  invoice: {
    intents: 'create/draft an invoice / invoice preview for review',
    create: 'POST /api/v1/invoices',
    never: 'Never paste raw invoice HTML or long line-item tables as the only review surface',
    humanAction: 'Humans review in the invoice canvas before send',
  },
  quote: {
    intents: 'create/draft a quote / quote preview for review',
    create: 'POST /api/v1/quotes',
    never: 'Never paste raw quote HTML as the only review surface',
    humanAction: 'Humans review in the quote canvas before send/convert',
  },
  campaign: {
    intents: 'create a campaign / content campaign for review',
    create: 'POST /api/v1/campaigns',
    never: 'Never dump the full campaign as chat-only markdown without opening the canvas',
    humanAction: 'Humans review campaign cards in the side canvas; approve/schedule in workspace',
  },
  social: {
    intents: 'draft a social post / post preview for review',
    create: 'POST /api/v1/social/posts',
    never: 'Never paste multi-platform post copy as chat-only “preview” without open_context',
    humanAction: 'Humans review social cards in the side canvas; approve/schedule in Marketing Studio',
  },
  document: {
    intents: 'create a proposal / spec / plan / report / client document for review',
    create: 'POST /api/v1/client-documents then POST /api/v1/client-documents/{id}/versions with blocks',
    never: 'Never paste raw rich_parts/studio_artifact JSON or the full document body as chat-only “preview”. Never use studio_artifact for client documents — kind is document',
    humanAction: 'Humans review the rendered document in the Context Dock; publish/share only after explicit approval',
  },
}

export function buildDynamicChatCanvasPromptBlock(input: {
  conversationId?: string | null
  responseMessageId?: string | null
}): string {
  const lines = [
    '[Messages dynamic chat — Context Dock / side canvas (mandatory)]',
    'When the user asks to draft, preview, or put something into a review surface in Messages, create the real platform record and open the side canvas. Do not fake a preview with chat prose alone.',
  ]
  if (input.conversationId) lines.push(`conversationId: ${input.conversationId}`)
  if (input.responseMessageId) lines.push(`responseMessageId: ${input.responseMessageId}`)
  lines.push('On every create call below, include conversationId + responseMessageId from this block (or conversationOrigin) so the platform auto-attaches open_context to this assistant message.')
  lines.push('Also echo returned uiActions/contextRef (structured uiActions / ui_actions, not only prose).')
  lines.push('Messages treats open_context { kind, id } as attach-and-open for the Context Dock.')
  lines.push(`Supported canvas kinds: ${MESSAGES_CANVAS_KINDS.join(', ')}.`)
  for (const kind of MESSAGES_CANVAS_KINDS) {
    const row = MESSAGES_CANVAS_REGISTRY[kind]
    lines.push(`- ${kind}: intents=${row.intents}; create=${row.create}; ${row.never}; ${row.humanAction}.`)
  }
  lines.push('Rich chat: prefer richParts + uiActions over long plain dumps for tables, approvals, clarify, and model pickers (see platform-ops).')
  lines.push('---', '')
  return lines.join('\n')
}
