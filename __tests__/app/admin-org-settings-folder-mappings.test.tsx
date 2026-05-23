import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import OrgSettingsPage from '@/app/(admin)/admin/org/[slug]/settings/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'acme-client' }),
}))

describe('OrgSettingsPage folder mappings', () => {
  beforeEach(() => {
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
          json: async () => ({ data: { id: 'org_1', name: 'Acme Client', settings: {} } }),
        } as Response)
      }
      if (url === '/api/v1/organizations/org_1/folder-mappings' && !init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'assets',
                name: 'Source Assets',
                folderType: 'assets',
                tags: ['drive', 'binary'],
                sortOrder: 10,
                driveFolderId: 'drive_123',
                driveFolderUrl: 'https://drive.google.com/drive/folders/drive_123',
                pathHints: { vps: '/var/lib/hermes/Cowork/Acme/assets', local: '~/Cowork/Acme/assets' },
                visibility: 'admin_agents_clients',
                sourceOfTruth: 'google_drive',
                syncMode: 'full',
                syncTargets: ['vps', 'local_cowork'],
                syncStatus: 'conflict',
                auditStatus: 'needs_review',
              },
            ],
          }),
        } as Response)
      }
      if (url === '/api/v1/organizations/org_1/folder-mappings/assets/resync') {
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

    fireEvent.click(screen.getByRole('button', { name: /Resync Source Assets/i }))
    await waitFor(() => expect(screen.getByText('Manual resync is not configured for this folder yet.')).toBeInTheDocument())
  })
})
