import { deleteGitHubToken } from '../../../../providers/github/server'

export default defineEventHandler(async () => {
  return deleteGitHubToken()
})
