<script setup lang="ts">
import type { FileRow } from '~/composables/useFileList'

defineProps<{
  file: FileRow
}>()
</script>

<template>
  <img
    v-if="file.kind === 'image'"
    :src="`/api/files/${file.id}/thumbnail`"
    :alt="file.path"
    class="w-10 h-10 object-cover rounded cursor-pointer"
    loading="lazy"
  >
  <div v-else class="w-10 h-10 rounded bg-(--ui-bg-accented) flex items-center justify-center">
    <UIcon name="i-lucide-file" class="text-(--ui-text-muted)" />
  </div>
</template>
