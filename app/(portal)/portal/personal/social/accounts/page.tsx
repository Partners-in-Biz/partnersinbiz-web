import SocialAccountsManager from '@/components/social/SocialAccountsManager'

export const dynamic = 'force-dynamic'

export default function PersonalSocialAccountsPage() {
  return (
    <SocialAccountsManager
      scope="personal"
      basePath="/portal/personal/social/accounts"
      eyebrow="Personal workspace"
      title="Personal social accounts"
      description="Connect the accounts owned by your user profile. They stay separate from shared organisation marketing accounts."
      emptyDescription="Connect your first personal account so your own drafts and scheduled posts have somewhere to publish."
    />
  )
}
