import { getGitHubConnectionStatus } from '../../../../providers/github/server'

export default defineEventHandler(async () => {
  return getGitHubConnectionStatus()
})
