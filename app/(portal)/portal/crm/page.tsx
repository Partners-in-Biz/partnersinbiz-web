import { HubPage } from '@/components/navigation/HubPage'

export const dynamic = 'force-dynamic'

export default function PortalCrmPage() {
  return (
    <HubPage
      eyebrow="Client portal"
      title="CRM"
      description="Contacts, companies, deals, lead capture, follow-up automation, and CRM reporting for this workspace."
      primaryAction={{
        label: 'Open contacts',
        href: '/portal/contacts',
        icon: 'contacts',
        description: 'View and manage CRM contacts.',
      }}
      sections={[
        {
          title: 'Sales workspace',
          actions: [
            {
              label: 'Contacts',
              href: '/portal/contacts',
              icon: 'contacts',
              description: 'View leads, prospects, clients, scores, tags, notes, and activity history.',
              eyebrow: 'People',
            },
            {
              label: 'Companies',
              href: '/portal/companies',
              icon: 'domain',
              description: 'Manage accounts, company health, linked contacts, deals, and activities.',
              eyebrow: 'Accounts',
            },
            {
              label: 'Deals',
              href: '/portal/deals',
              icon: 'monetization_on',
              description: 'Work the pipeline board, list view, forecast, line items, and deal stages.',
              eyebrow: 'Pipeline',
            },
            {
              label: 'Segments',
              href: '/portal/segments',
              icon: 'group_work',
              description: 'Build audience groups for campaigns, nurture, and client follow-up.',
              eyebrow: 'Audience',
            },
          ],
        },
        {
          title: 'Capture and communication',
          actions: [
            {
              label: 'Capture sources',
              href: '/portal/capture-sources',
              icon: 'inventory_2',
              description: 'Manage forms, imports, and public lead capture surfaces.',
              eyebrow: 'Leads',
            },
            {
              label: 'Integrations',
              href: '/portal/integrations',
              icon: 'extension',
              description: 'Connect CRM sources like Gmail, HubSpot, Mailchimp, and related systems.',
              eyebrow: 'Systems',
            },
            {
              label: 'Email',
              href: '/portal/email',
              icon: 'mail',
              description: 'Use the workspace mailbox and keep CRM communication in one place.',
              eyebrow: 'Inbox',
            },
            {
              label: 'CRM reports',
              href: '/portal/reports/crm',
              icon: 'query_stats',
              description: 'Review funnel, forecast, activity, pipeline velocity, and rep performance.',
              eyebrow: 'Reports',
            },
          ],
        },
        {
          title: 'Configuration',
          actions: [
            {
              label: 'CRM setup',
              href: '/portal/settings/crm-setup',
              icon: 'rocket_launch',
              description: 'Run the setup wizard and apply starter templates for the workspace.',
              eyebrow: 'Start',
            },
            {
              label: 'Pipelines',
              href: '/portal/settings/pipelines',
              icon: 'sync_alt',
              description: 'Configure deal pipelines, stages, probabilities, and defaults.',
              eyebrow: 'Stages',
            },
            {
              label: 'Custom fields',
              href: '/portal/settings/custom-fields',
              icon: 'tune',
              description: 'Define extra fields for contacts, companies, and deals.',
              eyebrow: 'Fields',
            },
            {
              label: 'Scoring',
              href: '/portal/settings/scoring',
              icon: 'star_rate',
              description: 'Tune ICP, lead-score weights, and AI lead scoring for the workspace.',
              eyebrow: 'AI',
            },
            {
              label: 'Products',
              href: '/portal/settings/products',
              icon: 'inventory',
              description: 'Manage products used for deal line items and quote conversion.',
              eyebrow: 'Catalog',
            },
            {
              label: 'Automations',
              href: '/portal/settings/automations',
              icon: 'bolt',
              description: 'Trigger notifications, assignments, webhooks, and sequences from CRM events.',
              eyebrow: 'Rules',
            },
            {
              label: 'Sequences',
              href: '/portal/settings/sequences',
              icon: 'route',
              description: 'Create nurture and follow-up sequences for contacts.',
              eyebrow: 'Follow-up',
            },
            {
              label: 'Webhooks',
              href: '/portal/settings/webhooks',
              icon: 'webhook',
              description: 'Send CRM events to external systems through signed outbound webhooks.',
              eyebrow: 'Events',
            },
          ],
        },
      ]}
    />
  )
}
