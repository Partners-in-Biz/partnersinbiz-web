import type { McpServerConfig, McpTransport } from './types'

export function createMcpServer(input: {
  orgId: string
  name: string
  transport: string
  endpoint: string
  toolAllowlist?: string[]
  toolDenylist?: string[]
  enabled?: boolean
  id?: string
}): McpServerConfig {
  const transport = input.transport.trim().toLowerCase() as McpTransport
  if (transport !== 'stdio' && transport !== 'http') {
    throw new Error('MCP transport must be stdio or http')
  }
  if (!input.name.trim()) throw new Error('MCP server name is required')
  if (!input.endpoint.trim()) throw new Error('MCP endpoint is required')
  if (transport === 'http' && !/^https?:\/\//i.test(input.endpoint.trim())) {
    throw new Error('HTTP MCP endpoint must be an http(s) URL')
  }
  const now = new Date().toISOString()
  return {
    id: input.id || `mcp_${Date.now()}`,
    orgId: input.orgId,
    name: input.name.trim(),
    transport,
    endpoint: input.endpoint.trim(),
    enabled: input.enabled !== false,
    toolAllowlist: input.toolAllowlist ? [...input.toolAllowlist] : undefined,
    toolDenylist: input.toolDenylist ? [...input.toolDenylist] : undefined,
    createdAt: now,
    updatedAt: now,
  }
}

export function filterMcpTools(
  tools: string[],
  server: Pick<McpServerConfig, 'toolAllowlist' | 'toolDenylist'>,
): string[] {
  let list = [...tools]
  if (server.toolAllowlist && server.toolAllowlist.length > 0) {
    const allow = new Set(server.toolAllowlist)
    list = list.filter((t) => allow.has(t))
  }
  if (server.toolDenylist && server.toolDenylist.length > 0) {
    const deny = new Set(server.toolDenylist)
    list = list.filter((t) => !deny.has(t))
  }
  return list
}
