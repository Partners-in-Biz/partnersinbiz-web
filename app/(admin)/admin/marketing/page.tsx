import { HubPage } from '@/components/navigation/HubPage'

export const dynamic = 'force-dynamic'

export default function AdminMarketingPage() {
  return (
    <HubPage
      eyebrow="Admin hub"
      title="Marketing"
      description="Plan, publish, review, and improve client growth work from one command surface."
      primaryAction={{
        label: 'Compose post',
        href: '/admin/social/compose',
        icon: 'edit_square',
        description: 'Create a social post.',
      }}
      sections={[
        {
          title: 'Campaign work',
          actions: [
            {
              label: 'Campaigns',
              href: '/admin/campaigns',
              icon: 'flag',
              description: 'Build and manage multi-asset client campaigns.',
              eyebrow: 'Content',
            },
            {
              label: 'Social media',
              href: '/admin/social',
              icon: 'campaign',
              description: 'Review queues, calendars, approvals, inboxes, accounts, and social links.',
              eyebrow: 'Publishing',
            },
            {
              label: 'SEO',
              href: '/admin/seo',
              icon: 'trending_up',
              description: 'Run sprints, draft content, monitor keywords, and track optimisation work.',
              eyebrow: 'Search',
            },
          ],
        },
        {
          title: 'Email and nurture',
          actions: [
            {
              label: 'Communications',
              href: '/admin/communications',
              icon: 'forum',
              description: 'Manage WhatsApp, SMS, email, in-app, Messenger, and Instagram conversations and campaigns.',
              eyebrow: 'Omnichannel',
            },
            {
              label: 'Email',
              href: '/admin/email',
              icon: 'mail',
              description: 'Manage broadcasts, drafts, scheduled sends, failed sends, and inbound mail.',
              eyebrow: 'Comms',
            },
            {
              label: 'Sequences',
              href: '/admin/sequences',
              icon: 'stacked_email',
              description: 'Create and maintain automated nurture journeys.',
              eyebrow: 'Automation',
            },
            {
              label: 'Email templates',
              href: '/admin/email-templates',
              icon: 'view_quilt',
              description: 'Maintain reusable email layouts and campaign blocks.',
              eyebrow: 'Assets',
            },
          ],
        },
        {
          title: 'Growth inputs',
          actions: [
            {
              label: 'Lead capture',
              href: '/admin/capture-sources',
              icon: 'inventory_2',
              description: 'Manage forms, embeds, imports, and capture source performance.',
              eyebrow: 'Leads',
            },
            {
              label: 'Social design',
              href: '/admin/social/design',
              icon: 'palette',
              description: 'Open design tools and creative assets used for social publishing.',
              eyebrow: 'Brand',
            },
            {
              label: 'Social accounts',
              href: '/admin/social/accounts',
              icon: 'hub',
              description: 'Connect and inspect client social platform accounts.',
              eyebrow: 'OAuth',
            },
          ],
        },
      ]}
    />
  )
}
