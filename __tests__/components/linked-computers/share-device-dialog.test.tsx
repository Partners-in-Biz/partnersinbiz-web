import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ShareDeviceDialog, type ShareDeviceDialogProps } from '@/components/linked-computers/ShareDeviceDialog'

const device = { deviceId: 'device-a', label: 'Studio Mac', ownerType: 'user' as const }
const teams = [{ teamId: 'org-a_sales', name: 'Sales' }, { teamId: 'org-a_ops', name: 'Ops' }]
const members = [{ uid: 'user-b', displayName: 'Sam Rivera' }, { uid: 'user-c', displayName: 'Alex Chen' }]

function renderDialog(overrides: Partial<ShareDeviceDialogProps> = {}) {
  const onSubmit = jest.fn(async () => undefined)
  const onClose = jest.fn()
  render(
    <ShareDeviceDialog
      device={device}
      orgId="org-a"
      orgName="Acme"
      grant={null}
      teams={teams}
      members={members}
      teamsEnabled
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { onSubmit, onClose }
}

describe('ShareDeviceDialog', () => {
  it('renders four modes when teams are enabled', () => {
    renderDialog({ teamsEnabled: true })
    expect(screen.getByRole('radio', { name: 'Only me' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Everyone in organisation' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Selected people' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Teams' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Share Studio Mac' })).toHaveTextContent(
      'Agents for this organisation run on your computer as your user. Sharing lets the people you pick start work there.',
    )
  })

  it('renders three modes when teams are not enabled', () => {
    renderDialog({ teamsEnabled: false })
    expect(screen.getByRole('radio', { name: 'Only me' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Everyone in organisation' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Selected people' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Teams' })).not.toBeInTheDocument()
  })

  it('submitting teams mode calls onSubmit with picked ids', async () => {
    const { onSubmit } = renderDialog({ teamsEnabled: true })
    fireEvent.click(screen.getByRole('radio', { name: 'Teams' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sales' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sam Rivera' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save organisation access' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      accessMode: 'teams',
      allowedUserIds: ['user-b'],
      allowedTeamIds: ['org-a_sales'],
    })
  })
})
