// app/(portal)/portal/settings/webhooks/page.tsx
export const dynamic = 'force-dynamic'

import { WebhookSettingsClient } from '@/components/crm/webhooks/WebhookSettingsClient'

export default function WebhookSettingsPage() {
  return <WebhookSettingsClient />
}
