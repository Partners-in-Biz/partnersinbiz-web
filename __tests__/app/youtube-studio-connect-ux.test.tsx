import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

const mockReplace = jest.fn()
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()
let mockSearch = ''

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/portal/youtube-studio',
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ success: mockToastSuccess, error: mockToastError, toast: jest.fn() }),
}))

import { YouTubeStudioOAuthReturnHandler } from '@/components/youtube-studio/YouTubeStudioOAuthReturnHandler'

describe('YouTubeStudioOAuthReturnHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearch = ''
  })

  it('fires a success toast, strips OAuth params, and triggers a refresh', async () => {
    mockSearch = 'status=success&platform=youtube&account=acct-1&orgId=lumen-org'
    const onRefresh = jest.fn()

    render(<YouTubeStudioOAuthReturnHandler onRefresh={onRefresh} onProvisionFailed={jest.fn()} />)

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled())
    expect(mockToastSuccess.mock.calls[0][0]).toMatch(/channel linked/i)
    expect(onRefresh).toHaveBeenCalled()
    // orgId survives; OAuth params are stripped
    expect(mockReplace).toHaveBeenCalledWith('/portal/youtube-studio?orgId=lumen-org', { scroll: false })
  })

  it('fires an error toast and reports the accountId when provisioning failed', async () => {
    mockSearch = 'status=success&platform=youtube&account=acct-1&provision=failed'
    const onProvisionFailed = jest.fn()

    render(<YouTubeStudioOAuthReturnHandler onRefresh={jest.fn()} onProvisionFailed={onProvisionFailed} />)

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(mockToastError.mock.calls[0][0]).toMatch(/setup.*incomplete/i)
    expect(onProvisionFailed).toHaveBeenCalledWith('acct-1')
    expect(mockReplace).toHaveBeenCalledWith('/portal/youtube-studio', { scroll: false })
  })

  it('surfaces the provider error message on OAuth failure', async () => {
    mockSearch = 'status=error&message=Access%20denied'

    render(<YouTubeStudioOAuthReturnHandler onRefresh={jest.fn()} onProvisionFailed={jest.fn()} />)

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Access denied'))
  })

  it('does nothing when no status param is present', () => {
    mockSearch = 'orgId=lumen-org'

    render(<YouTubeStudioOAuthReturnHandler onRefresh={jest.fn()} onProvisionFailed={jest.fn()} />)

    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
