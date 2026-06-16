// lib/ads/providers/google/customer-clients.ts
//
// Wraps `POST /customers/{manager}:createCustomerClient` — creates a brand-new
// Google Ads client account *under a manager (MCC)* account. This is distinct
// from `customers:listAccessibleCustomers` (which only discovers existing
// accounts): it provisions a new subaccount that the manager owns from the
// moment it's created (no email invitation handshake needed).
//
// Requires the platform `developer-token` and the manager account id passed as
// the `login-customer-id` header — the call is authorised *as the manager*.

import { GOOGLE_ADS_API_BASE_URL } from './constants'

export interface CreateCustomerClientArgs {
  /** Manager (MCC) 10-digit customer id, no dashes. */
  managerCustomerId: string
  accessToken: string
  developerToken: string
  /** Account display name, e.g. "AHS Law". */
  descriptiveName: string
  /** ISO 4217, e.g. "ZAR". */
  currencyCode: string
  /** IANA time zone, e.g. "Africa/Johannesburg". */
  timeZone: string
}

export interface CreateCustomerClientResult {
  /** Resource name of the created client, e.g. `customers/{manager}/customerClients/{clientId}`. */
  resourceName: string
  /** The new client account's 10-digit customer id (final path segment). */
  customerId: string
  /** Present only when manual access acceptance is required (legacy flows). */
  invitationLink?: string
}

export async function createCustomerClient(
  args: CreateCustomerClientArgs,
): Promise<CreateCustomerClientResult> {
  const url = `${GOOGLE_ADS_API_BASE_URL}/customers/${args.managerCustomerId}:createCustomerClient`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'developer-token': args.developerToken,
      // The mutation is performed as the manager that will own the new client.
      'login-customer-id': args.managerCustomerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customerClient: {
        descriptiveName: args.descriptiveName,
        currencyCode: args.currencyCode,
        timeZone: args.timeZone,
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Google Ads createCustomerClient failed: HTTP ${res.status} — ${text}`,
    )
  }

  const data = (await res.json()) as {
    resourceName?: string
    invitationLink?: string
  }
  const resourceName = data.resourceName ?? ''
  const customerId = resourceName.split('/').pop() ?? ''
  return { resourceName, customerId, invitationLink: data.invitationLink }
}
