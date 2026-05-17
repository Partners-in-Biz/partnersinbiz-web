export const SUPPORT_CATEGORIES = ['bug', 'question', 'content_change', 'billing', 'urgent'] as const
export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const SUPPORT_STATUSES = ['new', 'waiting_on_us', 'waiting_on_client', 'resolved'] as const
export const SUPPORT_AUTHOR_ROLES = ['client', 'admin', 'agent'] as const

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number]
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]
export type SupportAuthorRole = (typeof SUPPORT_AUTHOR_ROLES)[number]

export interface SupportTicket {
  id: string
  orgId: string
  orgName?: string
  createdBy: string
  requesterName: string
  requesterEmail: string
  category: SupportCategory
  subject: string
  description: string
  status: SupportStatus
  priority: SupportPriority
  sourceUrl?: string
  sourcePath?: string
  assignedToType?: 'user' | 'agent' | null
  assigneeUserId?: string | null
  assigneeAgentId?: string | null
  hermesStatus?: 'not_started' | 'suggested' | 'in_progress' | 'done' | 'failed'
  hermesSummary?: string | null
  messageCount: number
  lastMessagePreview?: string
  lastMessageAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  resolvedAt?: unknown
  deleted?: boolean
}

export interface SupportMessage {
  id: string
  ticketId: string
  orgId: string
  authorId: string
  authorRole: SupportAuthorRole
  authorName: string
  body: string
  attachments: Array<{ name: string; url: string; contentType?: string }>
  createdAt?: unknown
}
