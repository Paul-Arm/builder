<script setup lang="ts">
import type { EntityKind } from '~~/types/inventory'

defineProps<{
  kind: EntityKind
}>()
</script>

<template>
  <UBadge color="secondary" variant="soft" size="sm" class="entity-badge capitalize">
    {{ kind.replace('_', ' ') }}
  </UBadge>
</template>
