<script setup lang="ts">
import type { FileRow } from '~/composables/useFileList'

defineProps<{
  file: FileRow | null
}>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <UModal v-model:open="open">
    <template #content>
      <div v-if="file" class="p-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-(--ui-text-highlighted) truncate">
            {{ file.path }}
          </h2>
          <UButton
            icon="i-lucide-x"
            variant="ghost"
            color="neutral"
            @click="open = false"
          />
        </div>

        <FilesPreviewImage :file="file" />
        <FilesMetadataGrid :file="file" />
      </div>
    </template>
  </UModal>
</template>
