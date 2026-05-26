describe('sms Twilio readiness', () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
  })

  it('dry-runs safely when Twilio credentials are fully absent', async () => {
    delete process.env.TWILIO_ACCOUNT_SID
    delete process.env.TWILIO_AUTH_TOKEN
    delete process.env.TWILIO_MESSAGING_SERVICE_SID
    delete process.env.TWILIO_DEFAULT_FROM_NUMBER

    const twilioFactory = jest.fn()
    jest.doMock('twilio', () => ({ __esModule: true, default: twilioFactory }))

    const { sendSms } = await import('@/lib/sms/twilio')
    const result = await sendSms({ to: '+27821234567', body: 'Hello from PiB' })

    expect(result.ok).toBe(true)
    expect(result.twilioSid).toMatch(/^dryrun_/)
    expect(twilioFactory).not.toHaveBeenCalled()
  })

  it('fails closed when Twilio credentials are only partially configured', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123'
    delete process.env.TWILIO_AUTH_TOKEN
    delete process.env.TWILIO_MESSAGING_SERVICE_SID
    delete process.env.TWILIO_DEFAULT_FROM_NUMBER

    const twilioFactory = jest.fn()
    jest.doMock('twilio', () => ({ __esModule: true, default: twilioFactory }))

    const { sendSms } = await import('@/lib/sms/twilio')
    const result = await sendSms({ to: '+27821234567', body: 'Hello from PiB' })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('missing_twilio_credentials')
    expect(result.error).toMatch(/TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN/i)
    expect(twilioFactory).not.toHaveBeenCalled()
  })

  it('uses Messaging Service SID ahead of fallback from-number and sets the status callback', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123'
    process.env.TWILIO_AUTH_TOKEN = 'token'
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG123'
    process.env.TWILIO_DEFAULT_FROM_NUMBER = '+15551234567'
    process.env.NEXT_PUBLIC_BASE_URL = 'https://partnersinbiz.online/'

    const create = jest.fn().mockResolvedValue({ sid: 'SM123', numSegments: '1' })
    const twilioFactory = jest.fn(() => ({ messages: { create } }))
    jest.doMock('twilio', () => ({ __esModule: true, default: twilioFactory }))

    const { sendSms } = await import('@/lib/sms/twilio')
    const result = await sendSms({ to: '+27821234567', body: 'Hello from PiB' })

    expect(result.ok).toBe(true)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+27821234567',
        body: 'Hello from PiB',
        messagingServiceSid: 'MG123',
        statusCallback: 'https://partnersinbiz.online/api/v1/sms/status-webhook',
      }),
    )
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ from: expect.any(String) }))
  })
})
