export type AgentId = string

export type AgentTaskCard = {
  id: string
  source: 'project' | 'standalone'
  orgId: string
  title: string
  projectId: string | null
  projectName: string | null
  assigneeAgentId: AgentId | null
  agentStatus: string | null
  agentInputSpec: string | null
  agentOutputSummary: string | null
  priority: string | null
  tags: string[]
  labels?: string[]
  columnId?: string | null
  dependsOn?: string[]
  dependencyStatuses?: Record<string, string | null>
  linkedDocumentId?: string | null
  linkedDocumentIds?: string[]
  linkedDocuments?: Array<string | { id?: string | null; ref?: string | null; type?: string | null }>
  clientDocumentId?: string | null
  documentId?: string | null
  sourceOrigin?: string | null
  origin?: string | null
  originType?: string | null
  createdBy?: string | null
  clientOrgId?: string | null
  updatedAt: string | null
  createdAt: string | null
  href: string
}
