/** Hermes-aligned dangerous-command approval modes for Messages. */
export const VALID_APPROVAL_MODES = ['ask', 'smart', 'full'] as const

export type ApprovalMode = (typeof VALID_APPROVAL_MODES)[number]

export const APPROVAL_MODE_OPTIONS: Array<{
  value: ApprovalMode
  label: string
  description: string
  hermesEquivalent: string
}> = [
  {
    value: 'ask',
    label: 'Ask approvals',
    description: 'Prompt before dangerous commands (Hermes manual).',
    hermesEquivalent: 'approvals.mode: manual',
  },
  {
    value: 'smart',
    label: 'Smart approvals',
    description: 'Auto-allow low-risk commands; ask or deny the rest (Hermes smart).',
    hermesEquivalent: 'approvals.mode: smart',
  },
  {
    value: 'full',
    label: 'Full permissions',
    description: 'Skip dangerous-command prompts for this run (Hermes YOLO / mode off).',
    hermesEquivalent: 'approvals.mode: off / --yolo',
  },
]

export function cleanApprovalMode(value: unknown): ApprovalMode | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const cleaned = value.trim().toLowerCase()
  return VALID_APPROVAL_MODES.includes(cleaned as ApprovalMode) ? cleaned as ApprovalMode : null
}

export function approvalModeLabel(mode: ApprovalMode): string {
  return APPROVAL_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Ask approvals'
}

/** True when PiB should auto-resolve Hermes approval.required events. */
export function shouldAutoApproveDangerousCommands(mode: ApprovalMode | null | undefined): boolean {
  return mode === 'full'
}
