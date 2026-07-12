const MACHINE_MARKERS = [
  'googleimageproxy',
  'applewebkit',
  'outlook-ios',
  'barracuda',
  'proofpoint',
  'mimecast',
  'bot',
  'crawler',
]

export function classifyOpenPrivacy(input: {
  userAgent?: string
  privacyProxy?: boolean
  providerMachineFlag?: boolean
}): 'human' | 'machine' | 'privacy-affected' | 'unknown' {
  if (input.providerMachineFlag) return 'machine'
  if (input.privacyProxy) return 'privacy-affected'
  const agent = input.userAgent?.trim().toLowerCase()
  if (!agent) return 'unknown'
  if (MACHINE_MARKERS.some((marker) => agent.includes(marker))) return 'machine'
  return 'human'
}
