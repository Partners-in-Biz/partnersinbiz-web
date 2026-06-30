export const X_MCP_CONNECTION_KEY = 'x-mcp-user-account'
export const X_MCP_PROVIDER = 'x_mcp'
export const X_MCP_SERVER_URL = 'https://api.x.com/mcp'
export const X_MCP_DOCS_SERVER_URL = 'https://docs.x.com/mcp'
export const X_MCP_BRIDGE_PACKAGE = '@xdevplatform/xurl'

export const X_MCP_CAPABILITY_SCOPES = [
  'x.posts.read',
  'x.search.read',
  'x.users.read',
  'x.bookmarks.read',
  'x.bookmarks.write',
  'x.news.read',
  'x.articles.write',
] as const

export const X_MCP_SCOPE_ROWS = [
  { scope: 'tweet.read', classification: 'sensitive', approved: false, approvedBy: null, approvedAt: null, approvalGateTaskId: null },
  { scope: 'users.read', classification: 'sensitive', approved: false, approvedBy: null, approvedAt: null, approvalGateTaskId: null },
  { scope: 'bookmark.read', classification: 'restricted', approved: false, approvedBy: null, approvedAt: null, approvalGateTaskId: null },
  { scope: 'bookmark.write', classification: 'restricted', approved: false, approvedBy: null, approvedAt: null, approvalGateTaskId: null },
  { scope: 'offline.access', classification: 'restricted', approved: false, approvedBy: null, approvedAt: null, approvalGateTaskId: null },
] as const

export const X_MCP_CLIENT_CONFIG = {
  streamableHttpServer: X_MCP_SERVER_URL,
  docsServer: X_MCP_DOCS_SERVER_URL,
  command: `npx -y ${X_MCP_BRIDGE_PACKAGE} mcp ${X_MCP_SERVER_URL}`,
  installedCommand: `xurl mcp ${X_MCP_SERVER_URL}`,
  redirectUri: 'http://localhost:8080/callback',
  headlessAuthCommand: 'xurl auth oauth2 --headless',
  startupTimeoutSeconds: 300,
} as const
