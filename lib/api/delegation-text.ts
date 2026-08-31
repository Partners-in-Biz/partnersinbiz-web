/** User-visible ritual copy that must never appear in Messages / mailbox prompts. */
export const CHAT_REMINT_RITUAL_PATTERNS = [
  /re-send a (chat )?message to (re)?mint/i,
  /resend a (chat )?message to (re)?mint/i,
  /send any chat message to (re)?mint/i,
  /send another (chat )?message to (re)?mint/i,
  /re-send a message to mint a token/i,
  /send any chat message to mint a token/i,
]

export function redactDelegationSecretsFromText(value: string): string {
  return value
    .replace(/\bpib_dlg_[A-Za-z0-9]+\b/g, 'pib_dlg_[redacted]')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [redacted]')
}

export function containsChatRemintRitual(value: string): boolean {
  return CHAT_REMINT_RITUAL_PATTERNS.some((pattern) => pattern.test(value))
}
