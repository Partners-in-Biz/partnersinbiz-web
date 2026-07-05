import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CreativeProviderConnections from '@/components/creative-canvas/connections/CreativeProviderConnections'
import {
  listConnections,
  createConnection,
  revokeConnection,
  validateConnection,
} from '@/lib/creative-canvas/connections/client'

jest.mock('@/lib/creative-canvas/connections/client')

const mockList = listConnections as jest.MockedFunction<typeof listConnections>
const mockCreate = createConnection as jest.MockedFunction<typeof createConnection>
const mockRevoke = revokeConnection as jest.MockedFunction<typeof revokeConnection>
const mockValidate = validateConnection as jest.MockedFunction<typeof validateConnection>

const connectedXai = {
  id: 'org:org-1:xai',
  provider: 'xai',
  scope: 'org',
  label: 'Org xAI',
  status: 'connected',
  credentialHint: 'xai-…1234',
  hasCredentials: true,
} as any

beforeEach(() => {
  jest.clearAllMocks()
  mockList.mockResolvedValue([connectedXai])
  mockCreate.mockResolvedValue({ ...connectedXai } as any)
  mockRevoke.mockResolvedValue({ ...connectedXai, status: 'revoked' } as any)
  mockValidate.mockResolvedValue({ connection: connectedXai, validation: { ok: true } } as any)
})

test('lists connected providers with status and masked hint', async () => {
  render(<CreativeProviderConnections orgId="org-1" />)
  expect(await screen.findByText('Org xAI')).toBeInTheDocument()
  expect(screen.getByText('xai-…1234')).toBeInTheDocument()
})

test('connect form shows credential fields, scope radios and console link', async () => {
  render(<CreativeProviderConnections orgId="org-1" />)
  await screen.findByText('Org xAI')

  fireEvent.click(screen.getByRole('button', { name: /connect recraft/i }))

  expect(await screen.findByLabelText('API token')).toBeInTheDocument()
  expect(screen.getByLabelText(/this organisation/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/just me/i)).toBeInTheDocument()

  const link = screen.getByRole('link', { name: /get your key/i })
  expect(link).toHaveAttribute('href', 'https://app.recraft.ai/profile/api')
})

test('submitting with just me selected calls createConnection with user scope', async () => {
  render(<CreativeProviderConnections orgId="org-1" />)
  await screen.findByText('Org xAI')

  fireEvent.click(screen.getByRole('button', { name: /connect recraft/i }))
  fireEvent.change(await screen.findByLabelText('API token'), { target: { value: 'rk-abc' } })
  fireEvent.click(screen.getByLabelText(/just me/i))
  fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))

  await waitFor(() =>
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        provider: 'recraft',
        scope: 'user',
        credentials: { apiKey: 'rk-abc' },
      })
    )
  )
})

test('createConnection rejection surfaces inline', async () => {
  mockCreate.mockRejectedValueOnce(new Error('Provider rejected the key (401)'))
  render(<CreativeProviderConnections orgId="org-1" />)
  await screen.findByText('Org xAI')

  fireEvent.click(screen.getByRole('button', { name: /connect recraft/i }))
  fireEvent.change(await screen.findByLabelText('API token'), { target: { value: 'rk-bad' } })
  fireEvent.click(screen.getByRole('button', { name: /^connect$/i }))

  expect(await screen.findByText('Provider rejected the key (401)')).toBeInTheDocument()
})

test('disconnect calls revokeConnection with org and id', async () => {
  render(<CreativeProviderConnections orgId="org-1" />)
  await screen.findByText('Org xAI')

  fireEvent.click(screen.getByRole('button', { name: /disconnect/i }))

  await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('org-1', 'org:org-1:xai'))
})
