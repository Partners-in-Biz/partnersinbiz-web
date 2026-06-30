import { HubPage } from '@/components/navigation/HubPage'
import { PersonalXMcpConnectionCard } from '@/components/workspace-os/PersonalXMcpConnectionCard'

export const dynamic = 'force-dynamic'

export default function PersonalMarketingPage() {
  return (
    <div className="space-y-8">
      <HubPage
        eyebrow="Personal workspace"
        title="Personal marketing"
        description="Your own social accounts, drafts, scheduled posts, and personal X intelligence. This is user-owned and stays separate from company or organisation marketing workspaces."
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
                label: 'Compose personal post',
                href: '/portal/personal/social/compose',
                icon: 'edit_square',
                description: 'Draft or schedule content for accounts owned by your user profile.',
                eyebrow: 'Create',
              },
              {
                label: 'Personal accounts',
                href: '/portal/personal/social/accounts',
                icon: 'person_add',
                description: 'Connect and manage accounts owned by your user profile only.',
                eyebrow: 'Connect',
              },
              {
                label: 'Company accounts',
                href: '/portal/social/accounts',
                icon: 'business',
                description: 'Open the separate organisation account area for brand/client publishing.',
                eyebrow: 'Separate scope',
              },
            ],
          },
          {
            title: 'Personal X intelligence',
            actions: [
              {
                label: 'X MCP and bookmarks',
                href: '/portal/personal/social/accounts',
                icon: 'travel_explore',
                description: 'Prepare your user-owned hosted X MCP registry record for bookmarks, search, timelines, and article drafts.',
                eyebrow: 'Bookmarks',
              },
            ],
          },
        ]}
      />
      <PersonalXMcpConnectionCard setupSurface="portal_personal_marketing" />
    </div>
  )
}
