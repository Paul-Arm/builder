<script setup lang="ts">
import type { EntityKind } from '~~/types/inventory'

defineProps<{
  kind: EntityKind
}>()
</script>

<template>
  <UBadge color="secondary" variant="soft" size="sm" class="capitalize">
    {{ kind.replace('_', ' ') }}
  </UBadge>
</template>
