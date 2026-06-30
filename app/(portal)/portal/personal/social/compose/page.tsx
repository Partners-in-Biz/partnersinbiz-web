import SocialPostComposer from '@/components/social/SocialPostComposer'

export const dynamic = 'force-dynamic'

export default function PersonalSocialComposePage() {
  return (
    <SocialPostComposer
      scope="personal"
      title="Compose personal post"
      description="Create, preview, publish, or schedule content for your personal social accounts only. Company and organisation accounts stay separate."
      accountsHref="/portal/personal/social/accounts"
      afterSaveHref="/portal/personal/social/history"
      afterPublishHref="/portal/personal/social/history"
      previewFallbackName="Your Profile"
      previewFallbackHandle="@yourprofile"
      advanced
      queryPrefill
      accountFilter="connected"
      previewMode="toggle"
    />
  )
}
