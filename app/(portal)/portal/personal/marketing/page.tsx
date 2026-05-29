import { HubPage } from '@/components/navigation/HubPage'

export const dynamic = 'force-dynamic'

export default function PersonalMarketingPage() {
  return (
    <HubPage
      eyebrow="Personal workspace"
      title="Personal marketing"
      description="Your own social accounts, drafts, and scheduled posts. These stay separate from the organisation's shared marketing workspace."
      primaryAction={{
        label: 'Compose personal post',
        href: '/portal/personal/social/compose',
        icon: 'edit_square',
        description: 'Create a post for your own connected accounts.',
      }}
      sections={[
        {
          title: 'Personal social',
          actions: [
            {
              label: 'Compose',
              href: '/portal/personal/social/compose',
              icon: 'edit_square',
              description: 'Draft or schedule content for your personal social accounts.',
              eyebrow: 'Create',
            },
            {
              label: 'Accounts',
              href: '/portal/personal/social/accounts',
              icon: 'hub',
              description: 'Connect and manage accounts owned by your user profile.',
              eyebrow: 'Connect',
            },
          ],
        },
      ]}
    />
  )
}
