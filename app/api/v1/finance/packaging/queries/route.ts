import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestorePackagingFinanceGateway } from '@/lib/finance/packaging/firestore-gateway'
import { PackagingFinanceValidationError } from '@/lib/finance/packaging/service'
import type { PackagingFamily } from '@/lib/finance/packaging/types'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const
const FAMILIES = new Set<PackagingFamily>(['sars', 'payment', 'accountant'])

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestorePackagingFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/packaging/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource !== 'bundle') {
        throw new PackagingFinanceValidationError('Unsupported packaging finance query resource')
      }
      const bookId = params.get('bookId') || undefined
      const packId = params.get('packId') || undefined
      const familyRaw = params.get('family') || undefined
      const family =
        familyRaw && FAMILIES.has(familyRaw as PackagingFamily)
          ? (familyRaw as PackagingFamily)
          : undefined
      if (familyRaw && !family) {
        throw new PackagingFinanceValidationError('family must be sars|payment|accountant')
      }
      return gateway.listForOrg(actor, orgId, { bookId, family, packId })
    },
  })
})
