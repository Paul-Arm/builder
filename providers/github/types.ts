export type GitHubTokenSource = 'secret-store' | 'env' | 'missing'

export interface GitHubConnectionStatus {
  configured: boolean
  source: GitHubTokenSource
  storeReady: boolean
  user?: {
    login: string
    htmlUrl: string
    avatarUrl?: string
  }
  fingerprint?: string
  updatedAt?: string
  rateLimit?: {
    remaining?: number
    resetAt?: string
  }
  requiredPermissions: string[]
  error?: string
}

export interface GitHubSaveTokenRequest {
  token: string
}
