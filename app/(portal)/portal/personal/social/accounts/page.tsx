import SocialAccountsManager from '@/components/social/SocialAccountsManager'
import { PersonalXMcpConnectionCard } from '@/components/workspace-os/PersonalXMcpConnectionCard'

export const dynamic = 'force-dynamic'

export default function PersonalSocialAccountsPage() {
  return (
    <div className="space-y-8">
      <PersonalXMcpConnectionCard />
      <SocialAccountsManager
        scope="personal"
        basePath="/portal/personal/social/accounts"
        eyebrow="Personal workspace"
        title="Personal social accounts"
        description="Connect accounts owned by your user profile for your own posts. They stay separate from company and organisation marketing accounts."
        emptyDescription="Connect your first personal account so your own drafts and scheduled posts have somewhere to publish."
      />
    </div>
  )
}
