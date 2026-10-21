<script setup lang="ts">
const props = defineProps<{
  total: number
  pageSize: number
}>()

const page = defineModel<number>('page', { required: true })

const totalPages = computed(() => Math.ceil(props.total / props.pageSize))
</script>

<template>
  <div class="flex items-center justify-between">
    <span class="text-sm text-(--ui-text-muted)">
      Page {{ page }} of {{ totalPages }}
    </span>
    <UPagination
      v-model:page="page"
      :total="total"
      :items-per-page="pageSize"
      :sibling-count="1"
      show-edges
    />
  </div>
</template>
