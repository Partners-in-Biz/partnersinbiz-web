import { OPERATOR_NAV_TOPBAR } from '@/components/admin/navConfig'

describe('admin nav config', () => {
  it('exposes the internal mailbox so admins can link and use their email account', () => {
    const marketing = OPERATOR_NAV_TOPBAR.find((item) => item.label === 'Marketing')

    expect(marketing?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Internal mailbox',
          href: '/admin/email/mailbox',
        }),
      ])
    )
  })
})
