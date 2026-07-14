import { buildProjectSetupPlan } from '@/lib/project-locations/setup'

describe('project setup contract', () => {
  it('returns explicit existing-folder actions without claiming setup or sync completion', () => {
    const plan = buildProjectSetupPlan({
      mode: 'existing_folder', orgId: 'pib-platform-owner', projectName: 'Website refresh',
      locationId: 'peets-mac-mini', mappingId: 'mac-partners', workspaceId: 'partners',
    }, { actorUserId: 'peet', actorRole: 'admin' })

    expect(plan).toEqual(expect.objectContaining({
      mode: 'existing_folder', state: 'awaiting_mapping_confirmation', completed: false, syncCompleted: false,
    }))
    expect(plan.actions.map((action) => action.type)).toEqual([
      'confirm_existing_folder', 'create_project_record', 'link_project_location', 'verify_initial_sync',
    ])
  })

  it('returns explicit standard-project provisioning work', () => {
    const plan = buildProjectSetupPlan({
      mode: 'standard', orgId: 'pib-platform-owner', projectName: 'New campaign',
      workspaceId: 'partners', locationIds: ['partners-vps', 'peets-mac-mini'],
    }, { actorUserId: 'peet', actorRole: 'admin' })
    expect(plan.state).toBe('awaiting_standard_provisioning')
    expect(plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_standard_project_folder' }),
      expect.objectContaining({ type: 'verify_initial_sync' }),
    ]))
  })

  it('validates the client-manager domain slug and exposes the full-client orchestration boundary', () => {
    expect(() => buildProjectSetupPlan({
      mode: 'full_client', clientName: 'Acme Corp', domainSlug: '../acme', projectName: 'Acme launch',
    }, { actorUserId: 'peet', actorRole: 'admin' })).toThrow('domainSlug must be kebab-case')

    const plan = buildProjectSetupPlan({
      mode: 'full_client', clientName: 'Acme Corp', domainSlug: 'acme-corp', projectName: 'Acme launch',
    }, { actorUserId: 'peet', actorRole: 'admin' })
    expect(plan.state).toBe('awaiting_client_provisioning')
    expect(plan.completed).toBe(false)
    expect(plan.actions.map((action) => action.type)).toEqual([
      'create_client_organization', 'provision_client_workspace', 'create_project_record',
      'link_project_location', 'verify_initial_sync',
    ])
  })

  it('does not allow a client user to orchestrate full-client provisioning', () => {
    expect(() => buildProjectSetupPlan({
      mode: 'full_client', clientName: 'Acme Corp', domainSlug: 'acme-corp', projectName: 'Acme launch',
    }, { actorUserId: 'client-1', actorRole: 'client' })).toThrow('admin role required for full_client setup')
    expect(() => buildProjectSetupPlan({
      mode: 'full_client', clientName: 'Acme Corp', domainSlug: 'acme-corp', projectName: 'Acme launch',
    }, { actorUserId: 'agent:pip', actorRole: 'ai' })).toThrow('admin role required for full_client setup')
  })
})
