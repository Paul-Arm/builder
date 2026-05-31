import type { Component } from 'vue'

const providerUiComponents = new Map<string, Component>()

export function registerProviderUiComponent(id: string, component: Component) {
  providerUiComponents.set(id, component)
}

export function resolveProviderUiComponent(id?: string) {
  return id ? providerUiComponents.get(id) : undefined
}
