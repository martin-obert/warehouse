<script setup lang="ts">
const { page, pageSize, data, rows, total, isLoading } = await useFileList()
const { isOpen, file, open } = useFilePreview()
const { inputQuery, isActive: isSearching, hits, isLoading: isSearchLoading } = useSearch()

const sidebarCollapsed = ref(false)
</script>

<template>
  <div class="min-h-screen bg-(--ui-bg) flex flex-col">
    <header class="border-b border-(--ui-border) bg-(--ui-bg-elevated)">
      <div class="px-4 py-4 flex items-center gap-3">
        <UButton
          icon="i-lucide-panel-left"
          variant="ghost"
          color="neutral"
          @click="sidebarCollapsed = !sidebarCollapsed"
        />
        <h1 class="text-xl font-semibold text-(--ui-text-highlighted)">Warehouse</h1>
        <FilesSearchInput v-model="inputQuery" />
        <span v-if="data" class="ml-auto text-sm text-(--ui-text-muted)">
          {{ total }} files
        </span>
      </div>
    </header>

    <div class="flex flex-1 min-h-0">
      <FilesSidebar v-if="!sidebarCollapsed" />

      <main class="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6">
        <FilesSearchResults v-if="isSearching" :hits="hits" :loading="isSearchLoading" @select="open" />

        <template v-else>
          <FilesBreadcrumbs class="mb-4" />

          <UCard>
            <FilesTable :rows="rows" :loading="isLoading" @select="open" />

            <template #footer>
              <FilesPagination v-model:page="page" :total="total" :page-size="pageSize" />
            </template>
          </UCard>
        </template>
      </main>
    </div>

    <FilesPreviewModal v-model:open="isOpen" :file="file" />
  </div>
</template>
