import type { ProviderConnectionStatus } from '~~/types/providers'

export type DockerManagerAreaId =
  | 'dashboard'
  | 'containers'
  | 'volumes'
  | 'networks'
  | 'images'
  | 'stacks'

export interface DockerManagerArea {
  id: DockerManagerAreaId
  label: string
  url: string
}

export interface DockerManagerState {
  enabled: boolean
  baseUrl: string
  status: ProviderConnectionStatus
  checkedAt: string
  error?: string
  areas: DockerManagerArea[]
}
