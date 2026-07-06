import { bookStudioApiPath } from '@/lib/book-studio/client'

describe('bookStudioApiPath', () => {
  it('admin surface targets the admin API with orgId param', () => {
    expect(bookStudioApiPath('admin', 'projects', 'org-1'))
      .toBe('/api/v1/book-studio/projects?orgId=org-1')
  })
  it('portal surface targets the portal API without orgId (session-scoped)', () => {
    expect(bookStudioApiPath('portal', 'projects', 'org-1'))
      .toBe('/api/v1/portal/book-studio/projects')
  })
  it('record paths encode ids', () => {
    expect(bookStudioApiPath('portal', 'chapters', 'org-1', 'a b'))
      .toBe('/api/v1/portal/book-studio/chapters/a%20b')
  })
  it('admin record paths keep orgId param', () => {
    expect(bookStudioApiPath('admin', 'pages', 'org-1', 'p1'))
      .toBe('/api/v1/book-studio/pages/p1?orgId=org-1')
  })
})
