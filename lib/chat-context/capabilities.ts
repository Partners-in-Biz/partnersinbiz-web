import {
  CONTEXT_REFERENCE_TYPES,
  type ContextReferenceType,
} from '@/lib/context-references/types'

export const CHAT_CONTEXT_LIVE_REFRESH_MS = 5_000

export type ChatContextDomain =
  | 'delivery'
  | 'crm'
  | 'commerce'
  | 'knowledge'
  | 'marketing'
  | 'communications'
  | 'operations'
  | 'workspace'
  | 'studios'

export type ChatContextAdapterLevel = 'specialized' | 'canonical' | 'sealed_runtime'
export type ChatContextActionLevel = 'inline' | 'navigate'

export interface ChatContextCapabilityDescriptor {
  kind: ContextReferenceType
  domain: ChatContextDomain
  label: string
  adapterLevel: ChatContextAdapterLevel
  actionLevel: ChatContextActionLevel
  authoritativeSource: string
  liveRead: true
  refreshIntervalMs: number
  recommendedAgentIds: string[]
}

type DescriptorInput = Omit<ChatContextCapabilityDescriptor, 'kind' | 'liveRead' | 'refreshIntervalMs'>

function descriptor(kind: ContextReferenceType, input: DescriptorInput): ChatContextCapabilityDescriptor {
  return {
    kind,
    ...input,
    liveRead: true,
    refreshIntervalMs: CHAT_CONTEXT_LIVE_REFRESH_MS,
  }
}

/**
 * Exhaustive platform contract. Adding a context-reference type without
 * defining its live source and operating owner is a compile-time failure.
 */
export const CHAT_CONTEXT_CAPABILITIES = {
  project: descriptor('project', { domain: 'delivery', label: 'Project', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'Projects and Kanban', recommendedAgentIds: ['pip', 'theo', 'qa-release', 'docs'] }),
  task: descriptor('task', { domain: 'delivery', label: 'Task', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Project task subcollection', recommendedAgentIds: ['pip', 'theo', 'qa-release'] }),
  contact: descriptor('contact', { domain: 'crm', label: 'Contact', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'CRM contacts', recommendedAgentIds: ['sales', 'nora', 'pip'] }),
  company: descriptor('company', { domain: 'crm', label: 'Company', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'CRM companies', recommendedAgentIds: ['sales', 'nora', 'pip'] }),
  product: descriptor('product', { domain: 'commerce', label: 'Product', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Products', recommendedAgentIds: ['nora', 'sales', 'data'] }),
  document: descriptor('document', { domain: 'knowledge', label: 'Document', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'Client Documents, versions, review and tasks', recommendedAgentIds: ['docs', 'pip', 'nora'] }),
  research: descriptor('research', { domain: 'knowledge', label: 'Research', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Research workspace', recommendedAgentIds: ['sage', 'data', 'docs'] }),
  social: descriptor('social', { domain: 'marketing', label: 'Social post', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'Social publishing', recommendedAgentIds: ['maya', 'ads', 'data'] }),
  campaign: descriptor('campaign', { domain: 'marketing', label: 'Campaign', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'Campaign workspace', recommendedAgentIds: ['maya', 'ads', 'sales', 'data'] }),
  email: descriptor('email', { domain: 'communications', label: 'Email', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Mailbox', recommendedAgentIds: ['sales', 'support', 'nora'] }),
  support: descriptor('support', { domain: 'communications', label: 'Support ticket', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Support queue', recommendedAgentIds: ['support', 'pip', 'theo'] }),
  deal: descriptor('deal', { domain: 'crm', label: 'Deal', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'CRM deals', recommendedAgentIds: ['sales', 'nora', 'data'] }),
  invoice: descriptor('invoice', { domain: 'commerce', label: 'Invoice', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'Invoicing', recommendedAgentIds: ['nora', 'data', 'pip'] }),
  quote: descriptor('quote', { domain: 'commerce', label: 'Quote', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'Quotes', recommendedAgentIds: ['sales', 'nora', 'docs'] }),
  property: descriptor('property', { domain: 'operations', label: 'Property', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Properties', recommendedAgentIds: ['nora', 'data', 'pip'] }),
  seo_sprint: descriptor('seo_sprint', { domain: 'marketing', label: 'SEO sprint', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'SEO sprints and tasks', recommendedAgentIds: ['seo', 'sage', 'data'] }),
  workspace_folder: descriptor('workspace_folder', { domain: 'workspace', label: 'Workspace folder', adapterLevel: 'sealed_runtime', actionLevel: 'navigate', authoritativeSource: 'Authorised linked computer', recommendedAgentIds: ['pip', 'theo', 'docs'] }),
  workspace_artifact: descriptor('workspace_artifact', { domain: 'workspace', label: 'Workspace artifact', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Workspace artifact ledger', recommendedAgentIds: ['docs', 'pip', 'theo'] }),
  workspace_connection: descriptor('workspace_connection', { domain: 'workspace', label: 'Workspace connection', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Workspace connections', recommendedAgentIds: ['nora', 'pip', 'support'] }),
  workspace_broker_job: descriptor('workspace_broker_job', { domain: 'workspace', label: 'Workspace broker job', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Workspace broker', recommendedAgentIds: ['pip', 'theo', 'support'] }),
  studio: descriptor('studio', { domain: 'studios', label: 'Studio', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'Studio workspace', recommendedAgentIds: ['maya', 'pip', 'docs'] }),
  studio_artifact: descriptor('studio_artifact', { domain: 'studios', label: 'Studio artifact', adapterLevel: 'specialized', actionLevel: 'inline', authoritativeSource: 'Studio production records', recommendedAgentIds: ['maya', 'qa-release', 'docs'] }),
  file: descriptor('file', { domain: 'knowledge', label: 'File', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Uploads', recommendedAgentIds: ['docs', 'pip', 'theo'] }),
  report: descriptor('report', { domain: 'knowledge', label: 'Report', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Reports', recommendedAgentIds: ['data', 'sage', 'docs'] }),
  calendar_event: descriptor('calendar_event', { domain: 'communications', label: 'Calendar event', adapterLevel: 'canonical', actionLevel: 'navigate', authoritativeSource: 'Calendar events', recommendedAgentIds: ['nora', 'sales', 'pip'] }),
} satisfies Record<ContextReferenceType, ChatContextCapabilityDescriptor>

export function chatContextCapability(kind: ContextReferenceType): ChatContextCapabilityDescriptor {
  return CHAT_CONTEXT_CAPABILITIES[kind]
}

export function listChatContextCapabilities(): ChatContextCapabilityDescriptor[] {
  return CONTEXT_REFERENCE_TYPES.map((kind) => CHAT_CONTEXT_CAPABILITIES[kind])
}

export function summarizeChatContextCoverage(descriptors = listChatContextCapabilities()) {
  return {
    totalKinds: descriptors.length,
    liveReadKinds: descriptors.filter((item) => item.liveRead).length,
    specializedKinds: descriptors.filter((item) => item.adapterLevel === 'specialized').length,
    sealedRuntimeKinds: descriptors.filter((item) => item.adapterLevel === 'sealed_runtime').length,
    inlineActionKinds: descriptors.filter((item) => item.actionLevel === 'inline').length,
    navigateActionKinds: descriptors.filter((item) => item.actionLevel === 'navigate').length,
  }
}
