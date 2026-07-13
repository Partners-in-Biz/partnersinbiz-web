export type SalesReplyClassification = 'positive' | 'negative' | 'out_of_office' | 'neutral'

export interface ClassifiedSalesReply {
  classification: SalesReplyClassification
  confidence: number
  reasons: string[]
  assistiveOnly: true
}

const POSITIVE = [
  /\b(interested|sounds good|yes please|book|schedule|call me|let'?s talk|send (me )?(the )?proposal)\b/i,
  /\b(move forward|next steps?|go ahead)\b/i,
]
const NEGATIVE = [
  /\b(not interested|no thanks|do not contact|don'?t contact|remove me|not a fit|decline)\b/i,
]
const OUT_OF_OFFICE = [
  /\b(out of (the )?office|on leave|away from (the )?office|returning on|limited access to email)\b/i,
]

export function classifySalesReply(input: { subject?: string; bodyText?: string }): ClassifiedSalesReply {
  const text = `${input.subject ?? ''}\n${input.bodyText ?? ''}`.slice(0, 20_000)
  const score = (patterns: RegExp[]) => patterns.filter((pattern) => pattern.test(text)).length
  const ooo = score(OUT_OF_OFFICE)
  const negative = score(NEGATIVE)
  const positive = score(POSITIVE)

  if (ooo) return { classification: 'out_of_office', confidence: Math.min(0.98, 0.78 + ooo * 0.1), reasons: ['out_of_office_phrase'], assistiveOnly: true }
  if (negative) return { classification: 'negative', confidence: Math.min(0.98, 0.78 + negative * 0.1), reasons: ['negative_intent_phrase'], assistiveOnly: true }
  if (positive) return { classification: 'positive', confidence: Math.min(0.95, 0.68 + positive * 0.1), reasons: ['positive_intent_phrase'], assistiveOnly: true }
  return { classification: 'neutral', confidence: 0.5, reasons: ['no_strong_signal'], assistiveOnly: true }
}
