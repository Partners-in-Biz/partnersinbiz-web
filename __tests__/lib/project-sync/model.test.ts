import {
  applyProjectSyncInventory,
  applyProjectSyncTransferReceipt,
  buildProjectContentManifest,
  createProjectSyncRequest,
  type ProjectContentManifest,
  type ProjectSyncReplicaInput,
  type ProjectSyncWorkerBinding,
} from '@/lib/project-sync/model'

const NOW = '2026-07-13T22:00:00.000Z'

function manifest(projectId: string, files: Record<string, string>): ProjectContentManifest {
  return buildProjectContentManifest({
    projectId,
    entries: Object.entries(files).map(([path, sha256]) => ({ type: 'file', path, sha256, size: 10 })),
  })
}

function replicas(overrides: Partial<Record<'vps' | 'mac', Partial<ProjectSyncReplicaInput>>> = {}): ProjectSyncReplicaInput[] {
  return [
    {
      replicaId: 'replica-vps', locationId: 'partners-vps', mappingId: 'partners-vps-workspace',
      orgId: 'pib-platform-owner', projectId: 'project-a', availability: 'online', currentRevision: null,
      ...overrides.vps,
    },
    {
      replicaId: 'replica-mac', locationId: 'peets-mac-mini', mappingId: 'partners-mac-workspace',
      orgId: 'pib-platform-owner', projectId: 'project-a', availability: 'online', currentRevision: null,
      ...overrides.mac,
    },
  ]
}

function binding(requestId: string, replica: ProjectSyncReplicaInput): ProjectSyncWorkerBinding {
  return {
    capability: 'workspace.sync', requestId,
    orgId: replica.orgId, projectId: replica.projectId,
    replicaId: replica.replicaId, locationId: replica.locationId, mappingId: replica.mappingId,
  }
}

describe('project sync content manifests', () => {
  it('creates the same content revision regardless of entry order and includes empty directories', () => {
    const first = buildProjectContentManifest({
      projectId: 'project-a',
      entries: [
        { type: 'file', path: 'src/index.ts', sha256: 'a'.repeat(64), size: 12 },
        { type: 'directory', path: 'assets', size: 0 },
      ],
    })
    const reordered = buildProjectContentManifest({
      projectId: 'project-a',
      entries: [...first.entries].reverse(),
    })
    expect(reordered.revision).toBe(first.revision)
    expect(first.entries.map((entry) => entry.path)).toEqual(['assets', 'src/index.ts'])
    expect(first).toEqual(expect.objectContaining({ version: 1, totalBytes: 12, entryCount: 2 }))
  })

  it.each([
    ['absolute paths', '/etc/passwd'],
    ['parent traversal', '../outside'],
    ['git metadata', '.git/config'],
    ['environment secrets', '.env.local'],
    ['dependency trees', 'node_modules/pkg/index.js'],
    ['private key material', 'secrets/server.pem'],
  ])('rejects %s', (_label, path) => {
    expect(() => buildProjectContentManifest({
      projectId: 'project-a',
      entries: [{ type: 'file', path, sha256: 'a'.repeat(64), size: 1 }],
    })).toThrow('not eligible for project sync')
  })

  it('rejects duplicate paths, invalid hashes, and oversized entries', () => {
    expect(() => buildProjectContentManifest({
      projectId: 'project-a',
      entries: [
        { type: 'file', path: 'same.txt', sha256: 'a'.repeat(64), size: 1 },
        { type: 'file', path: 'same.txt', sha256: 'b'.repeat(64), size: 1 },
      ],
    })).toThrow('duplicate')
    expect(() => buildProjectContentManifest({
      projectId: 'project-a', entries: [{ type: 'file', path: 'file.txt', sha256: 'bad', size: 1 }],
    })).toThrow('sha256')
    expect(() => buildProjectContentManifest({
      projectId: 'project-a', entries: [{ type: 'file', path: 'file.bin', sha256: 'a'.repeat(64), size: 1_073_741_825 }],
    })).toThrow('maximum file size')
  })
})

describe('project sync coordinator state', () => {
  it('starts with a named canonical location and truthfully waits for an offline replica', () => {
    const request = createProjectSyncRequest({
      requestId: 'sync-request-a', orgId: 'pib-platform-owner', projectId: 'project-a',
      canonicalLocationId: 'partners-vps', requestedByUserId: 'peet',
      replicas: replicas({ mac: { availability: 'offline' } }), now: NOW,
    })
    expect(request).toEqual(expect.objectContaining({
      status: 'waiting_for_locations', canonicalLocationId: 'partners-vps',
      conflictPolicy: 'preserve_both_require_resolution', deletionPolicy: 'no_automatic_deletes',
      transferProtocol: 'firebase-storage-cas-v1', continuousExecutorVerified: false,
    }))
    expect(request.replicaStates.find((state) => state.replicaId === 'replica-mac')?.status).toBe('offline')
  })

  it('marks matching signed inventories synced without scheduling a fake transfer', () => {
    const request = createProjectSyncRequest({
      requestId: 'sync-request-a', orgId: 'pib-platform-owner', projectId: 'project-a',
      canonicalLocationId: 'partners-vps', requestedByUserId: 'peet', replicas: replicas(), now: NOW,
    })
    const same = manifest('project-a', { 'README.md': 'a'.repeat(64) })
    const withVps = applyProjectSyncInventory(request, {
      binding: binding(request.requestId, replicas()[0]), manifest: same, observedAt: NOW,
    })
    const reconciled = applyProjectSyncInventory(withVps, {
      binding: binding(request.requestId, replicas()[1]), manifest: same, observedAt: NOW,
    })
    expect(reconciled.status).toBe('synced')
    expect(reconciled.stateVersion).toBe(request.stateVersion + 2)
    expect(reconciled.canonicalRevision).toBe(same.revision)
    expect(reconciled.transfers).toEqual([])
    expect(reconciled.replicaStates.every((state) => state.status === 'synced')).toBe(true)
  })

  it('plans canonical-to-mirror transfer with a target revision precondition', () => {
    const base = manifest('project-a', { 'README.md': 'a'.repeat(64) })
    const scopedReplicas = replicas({
      vps: { currentRevision: base.revision }, mac: { currentRevision: base.revision },
    })
    const request = createProjectSyncRequest({
      requestId: 'sync-request-a', orgId: 'pib-platform-owner', projectId: 'project-a',
      canonicalLocationId: 'partners-vps', requestedByUserId: 'peet', replicas: scopedReplicas, now: NOW,
    })
    const canonical = manifest('project-a', { 'README.md': 'b'.repeat(64) })
    const one = applyProjectSyncInventory(request, {
      binding: binding(request.requestId, scopedReplicas[0]), manifest: canonical, observedAt: NOW,
    })
    const ready = applyProjectSyncInventory(one, {
      binding: binding(request.requestId, scopedReplicas[1]), manifest: base, observedAt: NOW,
    })
    expect(ready.status).toBe('ready')
    expect(ready.transfers).toEqual([
      expect.objectContaining({
        sourceReplicaId: 'replica-vps', targetReplicaId: 'replica-mac',
        expectedTargetRevision: base.revision, desiredRevision: canonical.revision,
        destructiveDeletes: false, status: 'planned',
      }),
    ])
  })

  it('bootstraps a server-attested pristine mirror from the canonical location on first sync', () => {
    const scopedReplicas = replicas()
    const request = createProjectSyncRequest({
      requestId: 'sync-request-bootstrap', orgId: 'pib-platform-owner', projectId: 'project-a',
      canonicalLocationId: 'partners-vps', requestedByUserId: 'peet', replicas: scopedReplicas, now: NOW,
    })
    const canonical = manifest('project-a', { 'README.md': 'b'.repeat(64) })
    const pristine = manifest('project-a', {})
    const one = applyProjectSyncInventory(request, {
      binding: binding(request.requestId, scopedReplicas[0]), manifest: canonical, observedAt: NOW,
    })
    const ready = applyProjectSyncInventory(one, {
      binding: binding(request.requestId, scopedReplicas[1]), manifest: pristine,
      pristineBootstrap: true, observedAt: NOW,
    })

    expect(ready.status).toBe('ready')
    expect(ready.proposedCanonicalRevision).toBe(canonical.revision)
    expect(ready.transfers).toEqual([
      expect.objectContaining({
        sourceReplicaId: 'replica-vps', targetReplicaId: 'replica-mac',
        expectedTargetRevision: pristine.revision, desiredRevision: canonical.revision,
      }),
    ])
  })

  it('preserves an unproven target when initial revisions differ', () => {
    const scopedReplicas = replicas()
    const request = createProjectSyncRequest({
      requestId: 'sync-request-unproven', orgId: 'pib-platform-owner', projectId: 'project-a',
      canonicalLocationId: 'partners-vps', requestedByUserId: 'peet', replicas: scopedReplicas, now: NOW,
    })
    const canonical = manifest('project-a', { 'README.md': 'b'.repeat(64) })
    const target = manifest('project-a', { 'local.txt': 'c'.repeat(64) })
    const conflict = applyProjectSyncInventory(applyProjectSyncInventory(request, {
      binding: binding(request.requestId, scopedReplicas[0]), manifest: canonical, observedAt: NOW,
    }), {
      binding: binding(request.requestId, scopedReplicas[1]), manifest: target, observedAt: NOW,
    })

    expect(conflict.status).toBe('conflict')
    expect(conflict.conflict?.kind).toBe('competing_revisions')
    expect(conflict.transfers).toEqual([])
  })

  it('safely promotes a sole mirror change when the canonical replica did not change', () => {
    const base = manifest('project-a', { 'README.md': 'a'.repeat(64) })
    const scopedReplicas = replicas({
      vps: { currentRevision: base.revision }, mac: { currentRevision: base.revision },
    })
    const request = createProjectSyncRequest({
      requestId: 'sync-request-a', orgId: 'pib-platform-owner', projectId: 'project-a',
      canonicalLocationId: 'partners-vps', requestedByUserId: 'peet', replicas: scopedReplicas, now: NOW,
    })
    const localChange = manifest('project-a', { 'README.md': 'c'.repeat(64) })
    const one = applyProjectSyncInventory(request, {
      binding: binding(request.requestId, scopedReplicas[0]), manifest: base, observedAt: NOW,
    })
    const ready = applyProjectSyncInventory(one, {
      binding: binding(request.requestId, scopedReplicas[1]), manifest: localChange, observedAt: NOW,
    })
    expect(ready.status).toBe('ready')
    expect(ready.proposedCanonicalRevision).toBe(localChange.revision)
    expect(ready.transfers[0]).toEqual(expect.objectContaining({
      sourceReplicaId: 'replica-mac', targetReplicaId: 'replica-vps', desiredRevision: localChange.revision,
    }))
  })

  it('preserves both versions when canonical and mirror changed differently', () => {
    const base = manifest('project-a', { 'README.md': 'a'.repeat(64) })
    const scopedReplicas = replicas({
      vps: { currentRevision: base.revision }, mac: { currentRevision: base.revision },
    })
    const request = createProjectSyncRequest({
      requestId: 'sync-request-a', orgId: 'pib-platform-owner', projectId: 'project-a',
      canonicalLocationId: 'partners-vps', requestedByUserId: 'peet', replicas: scopedReplicas, now: NOW,
    })
    const canonical = manifest('project-a', { 'README.md': 'b'.repeat(64) })
    const local = manifest('project-a', { 'README.md': 'c'.repeat(64) })
    const one = applyProjectSyncInventory(request, {
      binding: binding(request.requestId, scopedReplicas[0]), manifest: canonical, observedAt: NOW,
    })
    const conflict = applyProjectSyncInventory(one, {
      binding: binding(request.requestId, scopedReplicas[1]), manifest: local, observedAt: NOW,
    })
    expect(conflict.status).toBe('conflict')
    expect(conflict.transfers).toEqual([])
    expect(conflict.conflict).toEqual(expect.objectContaining({
      kind: 'competing_revisions', status: 'open', automaticOverwriteAllowed: false,
      revisions: expect.arrayContaining([canonical.revision, local.revision]),
    }))
  })

  it('requires exact tenant, mapping, replica, and sync capability bindings', () => {
    const request = createProjectSyncRequest({
      requestId: 'sync-request-a', orgId: 'pib-platform-owner', projectId: 'project-a',
      canonicalLocationId: 'partners-vps', requestedByUserId: 'peet', replicas: replicas(), now: NOW,
    })
    const report = { binding: { ...binding(request.requestId, replicas()[0]), orgId: 'another-org' }, manifest: manifest('project-a', {}), observedAt: NOW }
    expect(() => applyProjectSyncInventory(request, report)).toThrow('worker binding mismatch')
    expect(() => applyProjectSyncInventory(request, {
      ...report,
      binding: { ...binding(request.requestId, replicas()[0]), capability: 'workspace.execute' as 'workspace.sync' },
    })).toThrow('workspace.sync capability')
  })

  it('only completes after a verified transfer receipt and detects target drift', () => {
    const base = manifest('project-a', { 'README.md': 'a'.repeat(64) })
    const scopedReplicas = replicas({
      vps: { currentRevision: base.revision }, mac: { currentRevision: base.revision },
    })
    const request = createProjectSyncRequest({
      requestId: 'sync-request-a', orgId: 'pib-platform-owner', projectId: 'project-a',
      canonicalLocationId: 'partners-vps', requestedByUserId: 'peet', replicas: scopedReplicas, now: NOW,
    })
    const canonical = manifest('project-a', { 'README.md': 'b'.repeat(64) })
    const ready = applyProjectSyncInventory(applyProjectSyncInventory(request, {
      binding: binding(request.requestId, scopedReplicas[0]), manifest: canonical, observedAt: NOW,
    }), {
      binding: binding(request.requestId, scopedReplicas[1]), manifest: base, observedAt: NOW,
    })
    const transfer = ready.transfers[0]
    const synced = applyProjectSyncTransferReceipt(ready, {
      binding: binding(request.requestId, scopedReplicas[1]), transferId: transfer.transferId,
      beforeRevision: base.revision, appliedRevision: canonical.revision,
      verifiedManifestRevision: canonical.revision, verifiedAt: NOW,
    })
    expect(synced.status).toBe('synced')
    expect(synced.canonicalRevision).toBe(canonical.revision)
    expect(synced.transfers[0].status).toBe('verified')

    const drift = applyProjectSyncTransferReceipt(ready, {
      binding: binding(request.requestId, scopedReplicas[1]), transferId: transfer.transferId,
      beforeRevision: 'unexpected-revision', appliedRevision: canonical.revision,
      verifiedManifestRevision: canonical.revision, verifiedAt: NOW,
    })
    expect(drift.status).toBe('conflict')
    expect(drift.conflict).toEqual(expect.objectContaining({ kind: 'target_drift', automaticOverwriteAllowed: false }))
  })
})
