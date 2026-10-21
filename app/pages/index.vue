<script setup lang="ts">
const { page, pageSize, data, rows, total, isLoading } = await useFileList()
const { isOpen, file, open } = useFilePreview()
</script>

<template>
  <div class="min-h-screen bg-(--ui-bg)">
    <header class="border-b border-(--ui-border) bg-(--ui-bg-elevated)">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <h1 class="text-xl font-semibold text-(--ui-text-highlighted)">Warehouse</h1>
        <span v-if="data" class="text-sm text-(--ui-text-muted)">
          {{ total }} files
        </span>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <UCard>
        <FilesTable :rows="rows" :loading="isLoading" @select="open" />

        <template #footer>
          <FilesPagination v-model:page="page" :total="total" :page-size="pageSize" />
        </template>
      </UCard>
    </main>

    <FilesPreviewModal v-model:open="isOpen" :file="file" />
  </div>
</template>
