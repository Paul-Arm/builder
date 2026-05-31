import { readInventory } from './inventory-store'

export function readInventoryFromRuntimeConfig() {
  const config = useRuntimeConfig()

  return readInventory({
    url: config.surreal.url,
    namespace: config.surreal.namespace,
    database: config.surreal.database,
    username: config.surreal.username,
    password: config.surreal.password
  })
}
