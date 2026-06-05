import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('email mailbox shared workspace standard', () => {
  it('keeps admin and portal mailbox pages on one shared mailbox workspace', () => {
    const sharedPath = path.join(process.cwd(), 'components/mailbox/MailboxWorkspace.tsx')
    const oldAdminListPath = path.join(process.cwd(), 'components/admin/email/EmailList.tsx')
    const oldAdminDetailPath = path.join(process.cwd(), 'components/admin/email/EmailDetail.tsx')
    const adminInboxRoute = source('app/(admin)/admin/email/page.tsx')
    const adminRoute = source('app/(admin)/admin/email/mailbox/page.tsx')
    const portalRoute = source('app/(portal)/portal/email/page.tsx')

    expect(existsSync(sharedPath)).toBe(true)
    expect(existsSync(oldAdminListPath)).toBe(false)
    expect(existsSync(oldAdminDetailPath)).toBe(false)
    expect(source('components/mailbox/MailboxWorkspace.tsx')).toContain('export function MailboxWorkspace')

    expect(adminInboxRoute).toContain('@/components/mailbox/MailboxWorkspace')
    expect(adminInboxRoute).toContain('surface="admin"')
    expect(adminInboxRoute).not.toContain('@/components/admin/email/EmailList')
    expect(adminInboxRoute).not.toContain('@/components/admin/email/EmailDetail')
    expect(adminRoute).toContain('@/components/mailbox/MailboxWorkspace')
    expect(adminRoute).toContain('surface="admin"')
    expect(portalRoute).toContain('@/components/mailbox/MailboxWorkspace')
    expect(portalRoute).toContain('surface="portal"')

    for (const route of [adminInboxRoute, adminRoute, portalRoute]) {
      expect(route).not.toContain('const FOLDERS')
      expect(route).not.toContain('const EMAIL_TEMPLATES')
      expect(route).not.toContain('type AccountForm')
      expect(route).not.toContain('function htmlToText')
      expect(route).not.toContain('function MessagePane')
      expect(route).not.toContain('function ComposerPanel')
      expect(route).not.toContain('function RichComposer')
      expect(route).not.toContain('function ServerFields')
    }
  })
})
