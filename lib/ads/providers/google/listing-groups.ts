// lib/ads/providers/google/listing-groups.ts
// Google Ads asset group listing group filter helpers for Smart Shopping (Pmax + Merchant Center).
// Listing groups define which products are eligible within an asset group.
// Sub-3a-ext Smart Shopping.

import { GOOGLE_ADS_API_BASE_URL } from './constants'

interface CallArgs {
  customerId: string
  accessToken: string
  developerToken: string
  loginCustomerId?: string
}

function buildHeaders(args: CallArgs): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`,
    'developer-token': args.developerToken,
    'Content-Type': 'application/json',
  }
  if (args.loginCustomerId) h['login-customer-id'] = args.loginCustomerId
  return h
}

/**
 * Create a root SUBDIVISION + a single UNIT_INCLUDED child that catches all products.
 * This is the baseline listing group setup required for a Smart Shopping asset group.
 *
 * Google requires creating root + unit in separate requests because the unit
 * references the root's resource name which is only known after the first call.
 *
 * Returns the root subdivision and unit filter resourceNames.
 */
export async function createDefaultListingGroup(
  args: CallArgs & { assetGroupResourceName: string },
): Promise<{ rootResourceName: string; unitResourceName: string }> {
  const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.customerId}/assetGroupListingGroupFilters:mutate`

  // Step 1: Create the root subdivision (catches everything, no caseValue)
  const rootBody = {
    operations: [{
      create: {
        assetGroup: args.assetGroupResourceName,
        type: 'SUBDIVISION',
        caseValue: {},
      },
    }],
  }
  const rootRes = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(rootBody),
  })
  if (!rootRes.ok) {
    const text = await rootRes.text()
    throw new Error(`Smart Shopping root listing group create failed: HTTP ${rootRes.status} — ${text}`)
  }
  const rootData = await rootRes.json() as { results: Array<{ resourceName: string }> }
  const rootResourceName = rootData.results[0]?.resourceName
  if (!rootResourceName) throw new Error('Root listing group returned no resourceName')

  // Step 2: Create the unit child that includes all products (empty caseValue matches all)
  const unitBody = {
    operations: [{
      create: {
        assetGroup: args.assetGroupResourceName,
        parentListingGroupFilter: rootResourceName,
        type: 'UNIT_INCLUDED',
        caseValue: {},  // empty caseValue = match all products
      },
    }],
  }
  const unitRes = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(unitBody),
  })
  if (!unitRes.ok) {
    const text = await unitRes.text()
    throw new Error(`Smart Shopping unit listing group create failed: HTTP ${unitRes.status} — ${text}`)
  }
  const unitData = await unitRes.json() as { results: Array<{ resourceName: string }> }
  const unitResourceName = unitData.results[0]?.resourceName
  if (!unitResourceName) throw new Error('Unit listing group returned no resourceName')

  return { rootResourceName, unitResourceName }
}

/**
 * Create a UNIT_INCLUDED listing group filter scoped to a specific product brand.
 * The parent must be a SUBDIVISION listing group filter.
 */
export async function createBrandListingGroup(
  args: CallArgs & {
    assetGroupResourceName: string
    parentListingGroupFilterResourceName: string
    brandName: string
  },
): Promise<{ resourceName: string }> {
  const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.customerId}/assetGroupListingGroupFilters:mutate`
  const body = {
    operations: [{
      create: {
        assetGroup: args.assetGroupResourceName,
        parentListingGroupFilter: args.parentListingGroupFilterResourceName,
        type: 'UNIT_INCLUDED',
        caseValue: { productBrand: { value: args.brandName } },
      },
    }],
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Brand listing group create failed: HTTP ${res.status} — ${text}`)
  }
  const data = await res.json() as { results: Array<{ resourceName: string }> }
  return { resourceName: data.results[0]?.resourceName ?? '' }
}
