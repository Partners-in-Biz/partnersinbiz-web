import type { ConversationOrigin } from './types'

export interface LineageCarrier {
  conversationOrigin?: unknown
  chatOrigin?: unknown
}

function isConversationOrigin(value: unknown): value is ConversationOrigin {
  if (!value || typeof value !== 'object') return false
  const origin = value as Record<string, unknown>
  return ['conversationId', 'requestMessageId', 'responseMessageId', 'bundleId'].every(
    key => typeof origin[key] === 'string' && origin[key].length > 0 && origin[key].length <= 200
      && origin[key].trim() === origin[key] && !/[\/\u0000-\u001f\u007f]/.test(origin[key] as string),
  ) && Number.isSafeInteger(origin.sequence) && (origin.sequence as number) >= 0
}

export function normalizeConversationOrigin(carrier: LineageCarrier): ConversationOrigin | undefined {
  const value = isConversationOrigin(carrier.conversationOrigin)
    ? carrier.conversationOrigin
    : isConversationOrigin(carrier.chatOrigin) ? carrier.chatOrigin : undefined
  if (value) {
    return {
      conversationId: value.conversationId,
      requestMessageId: value.requestMessageId,
      responseMessageId: value.responseMessageId,
      bundleId: value.bundleId,
      sequence: value.sequence,
    }
  }
  return undefined
}

export function buildIdempotencyKey(targetDomain: string, origin: Pick<ConversationOrigin, 'bundleId' | 'sequence'>): string {
  return `${targetDomain.length}:${targetDomain}${origin.bundleId.length}:${origin.bundleId}:${origin.sequence}`
}
