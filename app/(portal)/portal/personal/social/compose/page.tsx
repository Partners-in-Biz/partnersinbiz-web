import SocialPostComposer from '@/components/social/SocialPostComposer'

export const dynamic = 'force-dynamic'

export default function PersonalSocialComposePage() {
  return (
    <SocialPostComposer
      scope="personal"
      title="Compose Personal Post"
      description="Create and schedule content for your personal social accounts only."
      accountsHref="/portal/personal/social/accounts"
      afterSaveHref="/portal/personal/marketing"
      previewFallbackName="Your Profile"
      previewFallbackHandle="@yourprofile"
    />
  )
}
