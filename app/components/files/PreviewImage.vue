<script setup lang="ts">
import type { FileRow } from '~/composables/useFileList'

defineProps<{
  file: FileRow
}>()
</script>

<template>
  <div v-if="file.kind === 'image'" class="flex justify-center bg-(--ui-bg-accented) rounded-lg p-2">
    <img
      :src="`/api/files/${file.id}/preview`"
      :alt="file.path"
      class="max-h-[70vh] max-w-full object-contain rounded"
    >
  </div>
  <div v-else class="flex flex-col items-center justify-center py-12 text-(--ui-text-muted)">
    <UIcon name="i-lucide-file" class="text-4xl mb-2" />
    <p>No preview available</p>
  </div>
</template>
