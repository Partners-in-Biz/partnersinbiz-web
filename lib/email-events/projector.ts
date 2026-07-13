import type { EmailEventType } from './types'

export interface EmailEventProjectionPlan {
  emailUpdate: Record<string, unknown>
  rollupField: string | null
  variantField: 'delivered' | 'opened' | 'clicked' | 'bounced' | 'unsubscribed' | null
}

/** Pure projection plan. Callers apply it only when appendEmailEvent.created. */
export function buildEmailEventProjection(event: EmailEventType, timestamp: unknown): EmailEventProjectionPlan {
  switch (event) {
    case 'delivered':
      return { emailUpdate: {}, rollupField: 'stats.delivered', variantField: 'delivered' }
    case 'opened':
    case 'machine_opened':
      return {
        emailUpdate: { status: 'opened', openedAt: timestamp },
        rollupField: 'stats.opened',
        variantField: 'opened',
      }
    case 'clicked':
      return {
        emailUpdate: { status: 'clicked', clickedAt: timestamp },
        rollupField: 'stats.clicked',
        variantField: 'clicked',
      }
    case 'bounced':
      return { emailUpdate: { status: 'failed' }, rollupField: 'stats.bounced', variantField: 'bounced' }
    case 'complained':
    case 'unsubscribed':
      return { emailUpdate: {}, rollupField: 'stats.unsubscribed', variantField: 'unsubscribed' }
    case 'deferred':
    case 'failed':
      return { emailUpdate: { status: 'failed' }, rollupField: null, variantField: null }
    default:
      return { emailUpdate: {}, rollupField: null, variantField: null }
  }
}
