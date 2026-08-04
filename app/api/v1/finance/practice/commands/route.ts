import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestorePracticeFinanceGateway,
  type AssignFinanceRoleCommand,
  type AuthorizePracticeGrantAccessCommand,
  type CreatePracticeGrantCommand,
  type EmitFinanceNotificationCommand,
  type MarkFinanceNotificationCommand,
  type RevokeFinanceRoleCommand,
  type RevokePracticeGrantCommand,
  type UpsertPracticeClientLinkCommand,
} from '@/lib/finance/practice/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'practice.role.assign',
  'practice.role.revoke',
  'practice.notification.emit',
  'practice.notification.mark',
  'practice.client_link.upsert',
  'practice.grant.create',
  'practice.grant.revoke',
  'practice.grant.authorize',
] as const

type PracticeOperation = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestorePracticeFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/practice/commands',
    execute: async (operation, actor, command) => {
      switch (operation as PracticeOperation) {
        case 'practice.role.assign':
          return gateway.assignRole(actor, command as unknown as AssignFinanceRoleCommand)
        case 'practice.role.revoke':
          return gateway.revokeRole(actor, command as unknown as RevokeFinanceRoleCommand)
        case 'practice.notification.emit':
          return gateway.emitNotification(actor, command as unknown as EmitFinanceNotificationCommand)
        case 'practice.notification.mark':
          return gateway.markNotification(actor, command as unknown as MarkFinanceNotificationCommand)
        case 'practice.client_link.upsert':
          return gateway.upsertClientLink(actor, command as unknown as UpsertPracticeClientLinkCommand)
        case 'practice.grant.create':
          return gateway.createGrant(actor, command as unknown as CreatePracticeGrantCommand)
        case 'practice.grant.revoke':
          return gateway.revokeGrant(actor, command as unknown as RevokePracticeGrantCommand)
        case 'practice.grant.authorize':
          return gateway.authorizeGrantAccess(actor, command as unknown as AuthorizePracticeGrantAccessCommand)
      }
    },
  })
})
