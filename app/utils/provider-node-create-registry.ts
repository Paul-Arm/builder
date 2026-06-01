import type { Component } from 'vue'

const registry = new Map<string, Component>()

export function registerProviderNodeCreateComponent(id: string, component: Component) {
  registry.set(id, component)
}

export function resolveProviderNodeCreateComponent(id?: string) {
  return id ? registry.get(id) : undefined
}
