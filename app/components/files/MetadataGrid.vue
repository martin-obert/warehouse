<script setup lang="ts">
import type { FileRow } from '~/composables/useFileList'
import { formatDate, humanSize } from '~/utils/file-format'

defineProps<{
  file: FileRow
}>()
</script>

<template>
  <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
    <div class="text-(--ui-text-muted)">Kind</div>
    <div>{{ file.kind }}</div>
    <div class="text-(--ui-text-muted)">MIME</div>
    <div>{{ file.mime }}</div>
    <div class="text-(--ui-text-muted)">Size</div>
    <div>{{ humanSize(file.size) }}</div>
    <div class="text-(--ui-text-muted)">Modified</div>
    <div>{{ formatDate(file.modifiedAt) }}</div>
    <template v-if="file.title">
      <div class="text-(--ui-text-muted)">Title</div>
      <div>{{ file.title }}</div>
    </template>
  </div>
</template>
