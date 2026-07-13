import { planLinkedRuntimeTransportCleanup } from '@/scripts/cleanup-linked-runtime-transports'

describe('legacy linked runtime transport cleanup', () => {
  it('deletes only legacy transport rows and allowlisted legacy fields without reading secret values', () => {
    const actions = planLinkedRuntimeTransportCleanup([
      { collection: 'linked_device_runtime_transports', id: 'device-a', data: { encryptedOutboundToken: 'secret', endpoint: 'https://legacy' } },
      { collection: 'linked_devices', id: 'device-a', data: { label: 'Mac', runtimeEndpoint: 'https://legacy', transportToken: 'secret' } },
      { collection: 'linked_device_credentials', id: 'device-a', data: { credentialHash: 'keep', encryptedTransportToken: { ciphertext: 'secret' } } },
      { collection: 'linked_device_rotation_deliveries', id: 'device-a', data: { encryptedCredential: 'keep', credentialVersion: 2 } },
      { collection: 'unrelated', id: 'x', data: { transportToken: 'leave' } },
    ])
    expect(actions).toEqual([
      { collection: 'linked_device_runtime_transports', id: 'device-a', kind: 'delete-document', fields: [] },
      { collection: 'linked_devices', id: 'device-a', kind: 'delete-fields', fields: ['runtimeEndpoint', 'transportToken'] },
      { collection: 'linked_device_credentials', id: 'device-a', kind: 'delete-fields', fields: ['encryptedTransportToken'] },
    ])
    expect(JSON.stringify(actions)).not.toMatch(/https:\/\/legacy|secret|credentialHash|encryptedCredential/)
  })

  it('is idempotent after legacy rows and fields are absent', () => {
    expect(planLinkedRuntimeTransportCleanup([
      { collection: 'linked_devices', id: 'device-a', data: { label: 'Mac' } },
      { collection: 'linked_device_credentials', id: 'device-a', data: { credentialHash: 'keep' } },
    ])).toEqual([])
  })
})
