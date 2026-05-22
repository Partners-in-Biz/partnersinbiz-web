// lib/api/api-keys.ts
// API key management for org-scoped agent access

import type { Timestamp } from 'firebase-admin/firestore'

export type ApiKeyRole = 'ai' | 'admin'

export interface ApiKeyPermission {
  resource: 'social' | 'projects' | 'tasks' | 'invoices' | 'pipeline' | 'platform'
  actions: ('read' | 'write' | 'delete')[]
}

export interface ApiKey {
  id?: string
  orgId: string             // Which org this key is scoped to (empty string = platform-level)
  agentId?: string | null   // Owning specialist when this is an agent key
  name: string              // Human-readable label e.g. "Social Agent"
  keyHash: string           // SHA-256 hash of the actual key — never store plaintext
  keyPrefix: string         // First 8 chars for identification e.g. "pib_ak_1"
  role: ApiKeyRole
  permissions: ApiKeyPermission[]
  lastUsedAt: Timestamp | null
  expiresAt: Timestamp | null
  revokedAt?: Timestamp | null
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type ApiKeyInput = Pick<ApiKey, 'orgId' | 'name' | 'role' | 'permissions' | 'expiresAt'>

export interface ApiKeyCreatedResponse {
  id: string
  keyPrefix: string
  /** Raw key — only returned ONCE at creation, never stored */
  rawKey: string
}
