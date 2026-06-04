import { CaptureSourcesWorkspace } from '@/components/capture-sources/CaptureSourcesWorkspace'

export const dynamic = 'force-dynamic'

export default function PortalCaptureSourcesPage() {
  return (
    <CaptureSourcesWorkspace
      importHref="/portal/capture-sources/import"
      sequenceNewHref="/portal/settings/sequences/new"
    />
  )
}
