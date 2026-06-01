import type { SequenceInput, SequenceStatus, SequenceStep } from '@/lib/sequences/types'

function stepChannel(step: SequenceStep): 'email' | 'sms' {
  return step.channel === 'sms' ? 'sms' : 'email'
}

export function sequenceStepReadinessError(step: SequenceStep, index: number): string | null {
  const stepNumber = index + 1
  if (stepChannel(step) === 'sms') {
    return step.smsBody?.trim() ? null : `Step ${stepNumber}: SMS body is required before activation.`
  }
  if (!step.subject?.trim()) return `Step ${stepNumber}: Subject is required before activation.`
  if (!step.bodyHtml?.trim() && !step.bodyText?.trim()) {
    return `Step ${stepNumber}: Email body is required before activation.`
  }
  return null
}

export function validateSequenceActivation(input: {
  status?: SequenceStatus
  steps?: SequenceStep[]
}): string | null {
  if (input.status !== 'active') return null
  const steps = input.steps ?? []
  if (steps.length === 0) return 'At least one sequence step is required before activation.'
  for (let i = 0; i < steps.length; i++) {
    const error = sequenceStepReadinessError(steps[i], i)
    if (error) return error
  }
  return null
}

export function mergeSequenceForActivationValidation(
  existing: SequenceInput,
  patch: Partial<SequenceInput>,
): Pick<SequenceInput, 'status' | 'steps'> {
  return {
    status: patch.status ?? existing.status,
    steps: patch.steps ?? existing.steps,
  }
}
