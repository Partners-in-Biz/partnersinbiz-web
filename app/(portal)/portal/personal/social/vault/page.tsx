'use client'
export const dynamic = 'force-dynamic'

import { SocialVaultWorkspace } from '@/app/(portal)/portal/social/vault/page'

export default function PersonalVaultPage() {
  return (
    <SocialVaultWorkspace
      personal
      title="Personal content vault"
      description="Approved personal posts and reusable content for your user-owned social accounts. Company and organisation vaults stay separate."
      composeHref="/portal/personal/social/compose"
    />
  )
}
