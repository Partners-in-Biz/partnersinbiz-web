import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import OrgSettingsPage from '@/app/(admin)/admin/org/[slug]/settings/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'acme-client' }),
}))

describe('OrgSettingsPage folder mappings', () => {
  let detailSettings: Record<string, unknown>

  beforeEach(() => {
    detailSettings = {}
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/organizations') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: 'org_1', slug: 'acme-client', name: 'Acme Client' }] }),
        } as Response)
      }
      if (url === '/api/v1/organizations/org_1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: 'org_1', name: 'Acme Client', settings: detailSettings } }),
        } as Response)
      }
      if (url === '/api/v1/workspace-connections?orgId=org_1') {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
      }
      if (url === '/api/v1/crm/companies?limit=100&orderBy=name-asc') {
        expect(init?.headers).toEqual(expect.objectContaining({ 'X-Org-Id': 'org_1', 'X-Org-Slug': 'acme-client' }))
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { companies: [{ id: 'company_1', name: 'Acme Holdings' }] } }),
        } as Response)
      }
      if (url === '/api/v1/workspace-folders?orgId=org_1') {
        expect(init?.headers).toEqual(expect.objectContaining({ 'X-Org-Id': 'org_1', 'X-Org-Slug': 'acme-client' }))
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: { folders: [
              {
                id: 'assets',
                orgId: 'org_1',
                name: 'Source Assets',
                resourceType: 'assets',
                resourceId: 'org_1',
                parentId: null,
                visibility: 'admin_agents_clients',
                tags: ['drive', 'binary'],
                sortOrder: 10,
                drive: { folderId: 'drive_123', folderUrl: 'https://drive.google.com/drive/folders/drive_123' },
                paths: { vpsPath: '/var/lib/hermes/Cowork/Acme/assets', localPathHint: '~/Cowork/Acme/assets' },
                sourceOfTruth: 'google_drive',
                syncMode: 'full',
                syncTargets: ['vps', 'local'],
                syncState: { status: 'conflict', lastSyncedAt: null, lastAttemptAt: null, error: null, conflictCount: 1 },
                audit: { conflictStatus: 'open', lastConflictAt: null, notes: null },
                permissions: { inheritParent: true, allowedAgentIds: [], allowedRoleIds: [], allowedUserIds: [] },
                deleted: false,
              },
            ] },
          }),
        } as Response)
      }
      if (url === '/api/v1/workspace-connections' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { id: 'conn_1' } }) } as Response)
      }
      if (url === '/api/v1/workspace-folders' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ data: { id: 'folder_2' } }) } as Response)
      }
      if (url === '/api/v1/workspace-folders/assets/resync?orgId=org_1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { queued: false, message: 'Manual resync is not configured for this folder yet.' } }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response)
    }) as jest.Mock
  })

  it('renders the admin folder registry and exposes manual resync status without portal publishing', async () => {
    render(<OrgSettingsPage />)

    await waitFor(() => expect(screen.getByText('Workspace folder registry')).toBeInTheDocument())
    expect(screen.getByText('Source Assets')).toBeInTheDocument()
    expect(screen.getByText('Admin + agents + clients')).toBeInTheDocument()
    expect(screen.getByText('Google Drive is source of truth')).toBeInTheDocument()
    expect(screen.getByText('Full sync')).toBeInTheDocument()
    expect(screen.getByText('VPS')).toBeInTheDocument()
    expect(screen.getByText('Local Cowork')).toBeInTheDocument()
    expect(screen.getByText('Portal exposure deferred')).toBeInTheDocument()
    expect(screen.getByText('Required Google OAuth setup')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Prepare 1 OAuth/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Resync Source Assets/i }))
    await waitFor(() => expect(screen.getByText('Manual resync is not configured for this folder yet.')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Prepare 1 OAuth/i }))
    await waitFor(() => {
      const post = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/workspace-connections' && init?.method === 'POST',
      )
      expect(post).toBeTruthy()
      const payload = JSON.parse(post![1].body as string)
      expect(payload).toMatchObject({
        connectionKey: 'google-workspace-drive-docs-sheets-gmail-calendar',
        connectionType: 'user_oauth',
        tokenStatus: 'needs_authorization',
        capabilityScopes: ['drive.read', 'drive.write', 'docs.write', 'sheets.write', 'gmail.read', 'gmail.send', 'calendar.events'],
        riskLevel: 'high',
      })
      expect(payload.scopes).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: 'https://www.googleapis.com/auth/drive.file', classification: 'sensitive' }),
        expect.objectContaining({ scope: 'https://www.googleapis.com/auth/gmail.send', classification: 'restricted' }),
        expect.objectContaining({ scope: 'https://www.googleapis.com/auth/calendar.events', classification: 'sensitive' }),
      ]))
      expect(screen.getByRole('link', { name: /Authorize Google Workspace/i })).toHaveAttribute(
        'href',
        '/api/v1/workspace-connections/google/authorize?orgId=org_1&connectionKey=google-workspace-drive-docs-sheets-gmail-calendar&returnTo=%2Fadmin%2Forg%2Facme-client%2Fsettings',
      )
    })
  })


  it('creates a CRM company Drive folder mapping through the workspace folder API with tenant headers', async () => {
    render(<OrgSettingsPage />)

    await waitFor(() => expect(screen.getByText('Workspace folder registry')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Mapping name'), { target: { value: 'NotebookLM research assets' } })
    fireEvent.change(screen.getByLabelText('Drive folder URL or ID'), { target: { value: 'https://drive.google.com/drive/folders/drive_folder_456?usp=sharing' } })
    fireEvent.change(screen.getByLabelText('Mapping scope'), { target: { value: 'crm_company' } })
    fireEvent.change(screen.getByLabelText('CRM company'), { target: { value: 'company_1' } })
    fireEvent.click(screen.getByRole('button', { name: /Add Drive folder mapping/i }))

    await waitFor(() => {
      const post = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/workspace-folders' && init?.method === 'POST',
      )
      expect(post).toBeTruthy()
      expect(post![1].headers).toEqual(expect.objectContaining({
        'Content-Type': 'application/json',
        'X-Org-Id': 'org_1',
        'X-Org-Slug': 'acme-client',
      }))
      expect(JSON.parse(post![1].body as string)).toMatchObject({
        orgId: 'org_1',
        name: 'NotebookLM research assets',
        resourceType: 'crm_company',
        resourceId: 'company_1',
        visibility: 'admin_agents',
        driveFolderId: 'drive_folder_456',
        driveFolderUrl: 'https://drive.google.com/drive/folders/drive_folder_456?usp=sharing',
        sourceOfTruth: 'google_drive',
        syncMode: 'metadata_only',
        tags: ['drive', 'research', 'notebooklm'],
      })
    })
    expect(await screen.findByText('Drive folder mapping saved. Review Drive sharing separately before making it client-visible.')).toBeInTheDocument()
  })


  it('loads and saves client portal module switches including Book Studio default-off posture', async () => {
    detailSettings = { portalModules: { mobileApps: false, youtubeStudio: false, bookStudio: true } }

    render(<OrgSettingsPage />)

    await waitFor(() => expect(screen.getByText('Client portal modules')).toBeInTheDocument())
    const mobileAppsSwitch = screen.getByLabelText('Mobile Apps') as HTMLInputElement
    expect(mobileAppsSwitch).not.toBeChecked()
    const youtubeStudioSwitch = screen.getByLabelText('YouTube Studio') as HTMLInputElement
    expect(youtubeStudioSwitch).not.toBeChecked()
    const bookStudioSwitch = screen.getByLabelText('Book Studio') as HTMLInputElement
    expect(bookStudioSwitch).toBeChecked()

    fireEvent.click(mobileAppsSwitch)
    fireEvent.click(youtubeStudioSwitch)
    fireEvent.click(bookStudioSwitch)
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    await waitFor(() => {
      const put = (global.fetch as jest.Mock).mock.calls.find(([url, init]) =>
        String(url) === '/api/v1/organizations/org_1' && init?.method === 'PUT',
      )
      expect(put).toBeTruthy()
      expect(JSON.parse(put![1].body as string)).toMatchObject({
        settings: {
          portalModules: {
            mobileApps: true,
            youtubeStudio: true,
            bookStudio: false,
          },
        },
      })
    })
  })
})
