import { fireEvent, render, screen } from '@testing-library/react'
import { CreateAgentOnMachineForm } from '@/components/agents/CreateAgentOnMachineForm'

describe('CreateAgentOnMachineForm', () => {
  it('submits access and named members for the selected machine', () => {
    const onSubmit = jest.fn()
    render(
      <CreateAgentOnMachineForm
        devices={[{ deviceId: 'mac-1', label: 'Peet Mac', deviceKind: 'computer', ownerType: 'user', supportsCustomAgents: true }]}
        defaultDeviceId="mac-1"
        members={[{ uid: 'user-2', displayName: 'Stean' }]}
        onSubmit={onSubmit}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Research' } })
    fireEvent.change(screen.getByPlaceholderText('Role'), { target: { value: 'Analyst' } })
    fireEvent.change(screen.getByPlaceholderText('Purpose and behaviour'), { target: { value: 'Cite sources.' } })
    fireEvent.click(screen.getByLabelText('Specific people'))
    fireEvent.click(screen.getByLabelText('Stean'))
    fireEvent.submit(screen.getByTestId('create-agent-on-machine'))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Research',
      deviceId: 'mac-1',
      accessMode: 'people',
      sharedWithUserIds: ['user-2'],
    }))
  })

  it('cannot pick just me on an organisation VPS', () => {
    render(
      <CreateAgentOnMachineForm
        devices={[{ deviceId: 'vps-1', label: 'Canonical VPS', deviceKind: 'vps', ownerType: 'organization', supportsCustomAgents: true }]}
        defaultDeviceId="vps-1"
        onSubmit={jest.fn()}
      />,
    )
    expect(screen.getByLabelText(/Just me/)).toBeDisabled()
    expect(screen.getByLabelText('Organisation owners and admins')).toBeChecked()
  })
})
