import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { NewSavedAudienceClient } from './NewSavedAudienceClient'

interface Params { slug: string }

export default async function NewSavedAudiencePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="pib-empty-state-description">Org not found.</div>
  return <NewSavedAudienceClient orgId={orgId} orgSlug={slug} />
}
