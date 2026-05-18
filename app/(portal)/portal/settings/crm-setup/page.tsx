// app/(portal)/portal/settings/crm-setup/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { CrmSetupWizard } from '@/components/crm/setup/CrmSetupWizard'

export default function CrmSetupPage() {
  return <CrmSetupWizard />
}
