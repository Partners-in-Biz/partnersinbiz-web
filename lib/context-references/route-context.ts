import {
  contextReferenceTypeFrom,
  type ContextReferenceSeed,
  type ContextReferenceType,
} from './types'

type SearchParamLike = URLSearchParams | { get: (key: string) => string | null } | null | undefined

interface DetectCurrentPageContextInput {
  pathname: string
  searchParams?: SearchParamLike
  orgId?: string
}

function ref(input: {
  type: ContextReferenceType
  id: string
  orgId?: string
  href: string
  label?: string
  metadata?: Record<string, unknown>
}): ContextReferenceSeed {
  return {
    type: input.type,
    id: decodeURIComponent(input.id),
    ...(input.orgId ? { orgId: input.orgId } : {}),
    ...(input.label ? { label: input.label } : {}),
    href: input.href,
    origin: 'current_page',
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
}

function matchPath(pathname: string, patterns: Array<[ContextReferenceType, RegExp]>, orgId?: string): ContextReferenceSeed | null {
  for (const [type, pattern] of patterns) {
    const match = pattern.exec(pathname)
    if (!match) continue
    const id = match[match.length - 1]
    if (!id || id === 'new' || id === 'compose') return null
    return ref({ type, id, orgId, href: pathname })
  }
  return null
}

export function detectCurrentPageContext(input: DetectCurrentPageContextInput): ContextReferenceSeed | null {
  const pathname = input.pathname.split('?')[0]
  const searchParams = input.searchParams
  const orgId = input.orgId

  const projectMatch = /^\/(?:admin\/org\/[^/]+\/projects|admin\/projects|portal\/projects)\/([^/]+)/.exec(pathname)
  if (projectMatch) {
    const taskId = searchParams?.get('taskId')?.trim()
    if (taskId) {
      return ref({
        type: 'task',
        id: taskId,
        orgId,
        href: `${pathname}?taskId=${encodeURIComponent(taskId)}`,
        metadata: { projectId: decodeURIComponent(projectMatch[1]) },
      })
    }
    return ref({ type: 'project', id: projectMatch[1], orgId, href: pathname })
  }

  const queryRefs: Array<[ContextReferenceType, string[]]> = [
    ['support', ['ticket', 'ticketId', 'supportId']],
    ['email', ['messageId', 'emailId', 'mailboxMessageId']],
    ['social', ['postId', 'socialPostId']],
    ['campaign', ['campaignId']],
  ]
  for (const [type, keys] of queryRefs) {
    for (const key of keys) {
      const id = searchParams?.get(key)?.trim()
      if (id) return ref({ type, id, orgId, href: `${pathname}?${key}=${encodeURIComponent(id)}` })
    }
  }

  const detected = matchPath(pathname, [
    ['contact', /^\/(?:admin\/crm\/contacts|portal\/contacts)\/([^/]+)/],
    ['company', /^\/(?:admin\/crm\/companies|portal\/companies)\/([^/]+)/],
    ['document', /^\/(?:admin\/org\/[^/]+\/documents|admin\/documents|portal\/documents)\/([^/]+)/],
    ['research', /^\/(?:admin\/org\/[^/]+\/research|admin\/research|portal\/research)\/([^/]+)/],
    ['campaign', /^\/(?:admin\/org\/[^/]+\/campaigns|admin\/campaigns|portal\/campaigns(?:\/(?:email|broadcast))?)\/([^/]+)/],
    ['social', /^\/(?:admin\/org\/[^/]+\/social|admin\/social\/(?:qa|history|calendar)|portal\/social\/(?:review|history|calendar))\/([^/]+)/],
    ['support', /^\/(?:admin|portal)\/support\/([^/]+)/],
    ['email', /^\/(?:admin\/email\/mailbox|portal\/email)\/([^/]+)/],
  ], orgId)

  if (detected) return detected
  const explicitType = contextReferenceTypeFrom(searchParams?.get('contextType'))
  const explicitId = searchParams?.get('contextId')?.trim()
  if (explicitType && explicitId) return ref({ type: explicitType, id: explicitId, orgId, href: pathname })
  return null
}
