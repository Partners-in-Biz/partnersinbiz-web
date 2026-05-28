import { detectCurrentPageContext } from '@/lib/context-references/route-context'

describe('context reference route detection', () => {
  it('detects admin project pages as current project context', () => {
    expect(detectCurrentPageContext({
      pathname: '/admin/org/acme/projects/project-123',
      orgId: 'org-1',
    })).toMatchObject({
      type: 'project',
      id: 'project-123',
      orgId: 'org-1',
      origin: 'current_page',
      href: '/admin/org/acme/projects/project-123',
    })
  })

  it('prefers a task reference when a project page has a taskId query param', () => {
    expect(detectCurrentPageContext({
      pathname: '/admin/org/acme/projects/project-123',
      searchParams: new URLSearchParams('taskId=task-9'),
      orgId: 'org-1',
    })).toMatchObject({
      type: 'task',
      id: 'task-9',
      orgId: 'org-1',
      origin: 'current_page',
      metadata: { projectId: 'project-123' },
    })
  })

  it('detects portal contact, document, research, and campaign pages', () => {
    expect(detectCurrentPageContext({ pathname: '/portal/contacts/contact-1', orgId: 'org-1' })).toMatchObject({
      type: 'contact',
      id: 'contact-1',
      href: '/portal/contacts/contact-1',
    })
    expect(detectCurrentPageContext({ pathname: '/portal/documents/doc-1', orgId: 'org-1' })).toMatchObject({
      type: 'document',
      id: 'doc-1',
    })
    expect(detectCurrentPageContext({ pathname: '/portal/research/research-1', orgId: 'org-1' })).toMatchObject({
      type: 'research',
      id: 'research-1',
    })
    expect(detectCurrentPageContext({ pathname: '/portal/campaigns/campaign-1', orgId: 'org-1' })).toMatchObject({
      type: 'campaign',
      id: 'campaign-1',
    })
  })

  it('detects support and mailbox context from route query params', () => {
    expect(detectCurrentPageContext({
      pathname: '/admin/support',
      searchParams: new URLSearchParams('ticket=support-1'),
      orgId: 'org-1',
    })).toMatchObject({
      type: 'support',
      id: 'support-1',
    })

    expect(detectCurrentPageContext({
      pathname: '/portal/email',
      searchParams: new URLSearchParams('messageId=email-1'),
      orgId: 'org-1',
    })).toMatchObject({
      type: 'email',
      id: 'email-1',
    })
  })
})
