// lib/automations/executor.ts
import { sendEmail } from '@/lib/email/send'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { AutomationAction, TriggerContext } from './types'

export interface ExecuteResult {
  succeeded: number
  failed: number
  errors: string[]
}

async function executeSendEmail(action: AutomationAction, context: TriggerContext): Promise<void> {
  let to: string | undefined

  if (action.emailTo === 'contact') {
    to = context.contactEmail
  } else if (action.emailTo === 'owner') {
    to = context.ownerEmail
  } else if (action.emailTo) {
    to = action.emailTo
  }

  if (!to) {
    // Skip — no resolvable address
    return
  }

  const result = await sendEmail({
    to,
    subject: action.emailSubject ?? '(no subject)',
    html: action.emailBody ?? '',
  })

  if (!result.success) {
    throw new Error(result.error ?? 'sendEmail failed')
  }
}

async function executeSendNotification(action: AutomationAction, context: TriggerContext): Promise<void> {
  if (action.notificationTo === 'all_admins') {
    // Query org members with admin role
    const snap = await adminDb
      .collection('orgMembers')
      .where('orgId', '==', context.orgId)
      .where('role', '==', 'admin')
      .get()

    const writes = snap.docs.map((d) =>
      adminDb.collection('notifications').add({
        orgId: context.orgId,
        userId: d.data().uid ?? d.id,
        message: action.notificationMessage ?? '',
        type: 'automation',
        createdAt: FieldValue.serverTimestamp(),
      })
    )
    await Promise.all(writes)
  } else {
    // Default: write a single org-level notification
    await adminDb.collection('notifications').add({
      orgId: context.orgId,
      message: action.notificationMessage ?? '',
      type: 'automation',
      createdAt: FieldValue.serverTimestamp(),
    })
  }
}

async function executeAssignOwner(action: AutomationAction, context: TriggerContext): Promise<void> {
  const patch = {
    ownerUid: action.ownerUid,
    ownerDisplayName: action.ownerDisplayName,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (context.dealId) {
    await adminDb.collection('deals').doc(context.dealId).update(patch)
  } else if (context.contactId) {
    await adminDb.collection('contacts').doc(context.contactId).update(patch)
  }
}

async function executeDispatchWebhook(action: AutomationAction, context: TriggerContext): Promise<void> {
  if (!action.webhookUrl) return

  const response = await fetch(action.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context),
  })

  if (!response.ok) {
    throw new Error(`Webhook POST failed: ${response.status} ${response.statusText}`)
  }
}

async function executeEnrollInSequence(action: AutomationAction, context: TriggerContext): Promise<void> {
  if (!action.sequenceId) {
    throw new Error('Sequence is required for automation enrollment')
  }

  if (!context.contactId) {
    throw new Error('Contact is required to enroll in a sequence')
  }

  const [{ getSequence }, { enrollContact }, { AGENT_PIP_REF }] = await Promise.all([
    import('@/lib/sequences/store'),
    import('@/lib/sequences/enrollment'),
    import('@/lib/orgMembers/memberRef'),
  ])

  const sequence = await getSequence(context.orgId, action.sequenceId)
  if (!sequence) {
    throw new Error('Sequence not found')
  }

  if (sequence.status !== 'active') {
    throw new Error('Sequence must be active before automation enrollment')
  }

  const firstStepDelayDays = sequence.steps[0]?.delayDays ?? 0
  await enrollContact(context.orgId, action.sequenceId, context.contactId, AGENT_PIP_REF, firstStepDelayDays)
}

export async function executeActions(
  actions: AutomationAction[],
  context: TriggerContext,
): Promise<ExecuteResult> {
  let succeeded = 0
  let failed = 0
  const errors: string[] = []

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'send_email':
          await executeSendEmail(action, context)
          break
        case 'send_notification':
          await executeSendNotification(action, context)
          break
        case 'assign_owner':
          await executeAssignOwner(action, context)
          break
        case 'dispatch_webhook':
          await executeDispatchWebhook(action, context)
          break
        case 'enroll_in_sequence':
          await executeEnrollInSequence(action, context)
          break
        default: {
          const _exhaustive: never = action.type
          throw new Error(`Unknown action type: ${_exhaustive}`)
        }
      }
      succeeded++
    } catch (err) {
      failed++
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  return { succeeded, failed, errors }
}
