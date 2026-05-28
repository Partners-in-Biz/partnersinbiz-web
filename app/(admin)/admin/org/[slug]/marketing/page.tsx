'use client'

import { useParams } from 'next/navigation'
import { HubPage } from '@/components/navigation/HubPage'

export const dynamic = 'force-dynamic'

export default function OrgMarketingPage() {
  const params = useParams()
  const slug = params.slug as string

  return (
    <HubPage
      eyebrow="Client workspace"
      title="Marketing"
      description="Brand, campaign, social, email, SEO, and lead-capture work for this client."
      primaryAction={{
        label: 'Compose post',
        href: '/admin/social/compose',
        icon: 'edit_square',
        description: 'Create a social post.',
      }}
      sections={[
        {
          title: 'Brand and campaigns',
          actions: [
            {
              label: 'Brand',
              href: `/admin/org/${slug}/brand`,
              icon: 'palette',
              description: 'Manage logo assets, voice, colours, handles, and brand direction.',
              eyebrow: 'Identity',
            },
            {
              label: 'Campaigns',
              href: `/admin/org/${slug}/campaigns`,
              icon: 'flag',
              description: 'Open the client campaign workspace and production pipeline.',
              eyebrow: 'Content',
            },
            {
              label: 'Ads',
              href: `/admin/org/${slug}/ads/campaigns`,
              icon: 'ads_click',
              description: 'Build, review, and monitor paid campaigns for this client.',
              eyebrow: 'Paid',
            },
            {
              label: 'SEO sprint',
              href: `/admin/org/${slug}/seo`,
              icon: 'trending_up',
              description: 'Create or open the client SEO sprint.',
              eyebrow: 'Search',
            },
          ],
        },
        {
          title: 'Publishing',
          actions: [
            {
              label: 'Social overview',
              href: `/admin/org/${slug}/social`,
              icon: 'campaign',
              description: 'Review client social status and publishing health.',
              eyebrow: 'Social',
            },
            {
              label: 'Compose',
              href: '/admin/social/compose',
              icon: 'edit_square',
              description: 'Draft and schedule posts for connected platforms.',
              eyebrow: 'Create',
            },
            {
              label: 'Calendar',
              href: '/admin/social/calendar',
              icon: 'calendar_month',
              description: 'See scheduled and planned posts across channels.',
              eyebrow: 'Schedule',
            },
            {
              label: 'History',
              href: '/admin/social/history',
              icon: 'history',
              description: 'Review published, failed, and cancelled social posts.',
              eyebrow: 'Archive',
            },
            {
              label: 'Queue',
              href: '/admin/social/queue',
              icon: 'pending_actions',
              description: 'Work through publishing, approval, and retry queues.',
              eyebrow: 'Ops',
            },
            {
              label: 'Accounts',
              href: '/admin/social/accounts',
              icon: 'hub',
              description: 'Connect and troubleshoot social accounts.',
              eyebrow: 'OAuth',
            },
            {
              label: 'Links',
              href: '/admin/social/links',
              icon: 'link',
              description: 'Manage link-in-bio and campaign link surfaces.',
              eyebrow: 'Profile',
            },
          ],
        },
        {
          title: 'Email and capture',
          actions: [
            {
              label: 'Email',
              href: '/admin/email',
              icon: 'mail',
              description: 'Manage client email drafts, scheduled sends, broadcasts, and failures.',
              eyebrow: 'Comms',
            },
            {
              label: 'Communications',
              href: '/admin/communications',
              icon: 'forum',
              description: 'Manage conversations, campaign replies, templates, queues, and channel health.',
              eyebrow: 'Omnichannel',
            },
            {
              label: 'Email analytics',
              href: '/admin/email-analytics',
              icon: 'query_stats',
              description: 'Review email delivery, opens, clicks, and source performance.',
              eyebrow: 'Reporting',
            },
            {
              label: 'Sequences',
              href: '/admin/sequences',
              icon: 'stacked_email',
              description: 'Maintain client nurture journeys.',
              eyebrow: 'Automation',
            },
            {
              label: 'Contacts',
              href: '/admin/crm/contacts',
              icon: 'contacts',
              description: 'Manage leads, prospects, clients, tags, and lifecycle stages.',
              eyebrow: 'Audience',
            },
            {
              label: 'Capture sources',
              href: `/admin/org/${slug}/capture-sources`,
              icon: 'inventory_2',
              description: 'Manage forms, imports, and lead capture surfaces.',
              eyebrow: 'Leads',
            },
            {
              label: 'Email domains',
              href: `/admin/org/${slug}/email-domains`,
              icon: 'dns',
              description: 'Check sender domains and verification state.',
              eyebrow: 'Deliverability',
            },
            {
              label: 'Integrations',
              href: `/admin/org/${slug}/integrations`,
              icon: 'extension',
              description: 'Connect CRMs, analytics, and external systems for this client.',
              eyebrow: 'Connections',
            },
          ],
        },
      ]}
    />
  )
}
