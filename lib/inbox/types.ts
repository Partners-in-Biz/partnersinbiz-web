// lib/inbox/types.ts
// Types for the unified workspace inbox — aggregates across sources.

export type InboxItemType =
  | 'notification'
  | 'mention'
  | 'assignment'
  | 'approval'
  | 'overdue_invoice'
  | 'pending_task'
  | 'partner_invite'

export interface InboxItem {
  id: string
  itemType: InboxItemType
  resourceType: string
  resourceId: string
  title: string
  body: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  link: string | null
  createdAt: string
  data?: Record<string, unknown>
}
