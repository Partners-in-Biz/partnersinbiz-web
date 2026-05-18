export type KnowledgeScope = 'shared' | 'agent'
export type KnowledgeSection = 'index' | 'wiki' | 'raw' | 'logs'

export interface KnowledgeItem {
  path: string
  name: string
  type: 'file' | 'dir'
  sizeBytes?: number
  updatedAt?: string
}

export interface KnowledgeNote {
  path: string
  name: string
  content: string
  sizeBytes?: number
  updatedAt?: string
}

export interface KnowledgeListing {
  scope: KnowledgeScope
  section: KnowledgeSection
  agent?: string
  root: string
  items: KnowledgeItem[]
}

export interface KnowledgeSaveResult {
  path: string
  committed?: boolean
  commitError?: string
}
