import type { GitHubSaveTokenRequest } from '../../../../providers/github/types'
import { saveGitHubToken } from '../../../../providers/github/server'

export default defineEventHandler(async (event) => {
  const body = await readBody<GitHubSaveTokenRequest>(event)

  return saveGitHubToken(body.token)
})
