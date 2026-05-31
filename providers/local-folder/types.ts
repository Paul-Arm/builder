export type LocalFolderPreviewSource = 'server' | 'browser'
export type LocalFolderPreviewEntryKind = 'file' | 'directory'

export interface LocalFolderPreviewEntry {
  name: string
  kind: LocalFolderPreviewEntryKind
  relativePath: string
  size?: number
  modifiedAt?: string
}

export interface LocalFolderPreview {
  source: LocalFolderPreviewSource
  rootLabel: string
  rootPath?: string
  generatedAt: string
  fileCount: number
  directoryCount: number
  truncated: boolean
  entries: LocalFolderPreviewEntry[]
}

export interface LocalFolderPreviewRequest {
  path?: string
}
