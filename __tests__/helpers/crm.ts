/**
 * Shared seed helpers for CRM tenant-isolation tests.
 * Used by PR 1 middleware tests and every PR 2-8 isolation test.
 *
 * Firebase Admin is mocked at the consumer site — these helpers assume the
 * mock is in place and return plain objects matching the production shape.
 */
import { Timestamp } from 'firebase-admin/firestore'
import type { NextRequest } from 'next/server'
import type { OrgRole } from '@/lib/organizations/types'
import type { Contact, Deal, Activity } from '@/lib/crm/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export interface SeededMember {
  orgId: string
  uid: string
  role: OrgRole
  firstName: string
  lastName: string
  ref: MemberRef
}

export function seedOrgMember(
  orgId: string,
  uid: string,
  opts: { role: OrgRole; firstName?: string; lastName?: string } = { role: 'member' },
): SeededMember {
  const firstName = opts.firstName ?? 'Test'
  const lastName = opts.lastName ?? uid
  return {
    orgId,
    uid,
    role: opts.role,
    firstName,
    lastName,
    ref: { uid, displayName: `${firstName} ${lastName}`, kind: 'human' },
  }
}

export function seedContact(orgId: string, overrides: Partial<Contact> = {}): Contact {
  const now = Timestamp.now()
  return {
    id: overrides.id ?? `contact-${Math.random().toString(36).slice(2, 8)}`,
    orgId,
    capturedFromId: 'manual',
    name: 'Test Contact',
    email: 'test@example.com',
    phone: '',
    company: '',
    website: '',
    source: 'manual',
    type: 'lead',
    stage: 'new',
    tags: [],
    notes: '',
    assignedTo: '',
    subscribedAt: null,
    unsubscribedAt: null,
    bouncedAt: null,
    createdAt: now,
    updatedAt: now,
    lastContactedAt: null,
    ...overrides,
  } as Contact
}

export function seedDeal(orgId: string, overrides: Partial<Deal> = {}): Deal {
  const now = Timestamp.now()
  return {
    id: overrides.id ?? `deal-${Math.random().toString(36).slice(2, 8)}`,
    orgId,
    contactId: '',
    title: 'Test Deal',
    value: 0,
    currency: 'ZAR',
    // A3 W2-F: pipelineId + stageId replace the old stage: DealStage field
    pipelineId: 'pl-default',
    stageId: 'discovery',
    expectedCloseDate: null,
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Deal
}

export function seedActivity(orgId: string, contactId: string, overrides: Partial<Activity> = {}): Activity {
  const now = Timestamp.now()
  return {
    id: overrides.id ?? `activity-${Math.random().toString(36).slice(2, 8)}`,
    orgId,
    contactId,
    dealId: '',
    type: 'note',
    summary: '',
    metadata: {},
    createdBy: 'uid-unknown',
    createdAt: now,
    ...overrides,
  } as Activity
}

/** Builds a NextRequest authenticated as the given member via the session cookie path. */
export function callAsMember(
  m: SeededMember,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
): NextRequest {
  const headers: Record<string, string> = {
    cookie: `__session=test-session-${m.uid}`,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NextRequest } = require('next/server')
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: new Headers(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as NextRequest
}

/** Builds a NextRequest authenticated as the synthetic agent via Bearer key. */
export function callAsAgent(
  orgId: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  apiKey = process.env.AI_API_KEY ?? 'test-ai-key',
): NextRequest {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'x-org-id': orgId,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NextRequest } = require('next/server')
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: new Headers(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as NextRequest
}
