import type { LocalFolderPreviewRequest } from '../../../../providers/local-folder/types'
import { previewConfiguredLocalFolder } from '../../../../providers/local-folder/server'

export default defineEventHandler(async (event) => {
  const body = await readBody<LocalFolderPreviewRequest>(event)

  return previewConfiguredLocalFolder(body.path)
})
