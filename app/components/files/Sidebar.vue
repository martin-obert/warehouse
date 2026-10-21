<script setup lang="ts">
const { data } = await useFetch('/api/folders', { query: { path: '' } })
const folders = computed(() => data.value?.folders ?? [])
</script>

<template>
  <nav class="w-56 shrink-0 border-r border-(--ui-border) overflow-y-auto py-2">
    <FilesFolderTreeNode
      v-for="folder in folders"
      :key="folder"
      :path="folder"
      :name="folder"
    />
    <p v-if="folders.length === 0" class="px-2 py-1 text-sm text-(--ui-text-dimmed)">
      No folders
    </p>
  </nav>
</template>
