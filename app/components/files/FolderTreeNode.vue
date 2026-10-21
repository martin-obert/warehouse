<script setup lang="ts">
const props = withDefaults(defineProps<{
  path: string
  name: string
  depth?: number
}>(), {
  depth: 0,
})

const { path: currentPath, navigate } = useCurrentFolder()
const isActive = computed(() => currentPath.value === props.path)

const expanded = ref(false)
const children = ref<string[] | null>(null)

async function toggle() {
  if (children.value === null) {
    const { folders } = await $fetch('/api/folders', { query: { path: props.path } })
    children.value = folders
  }
  expanded.value = !expanded.value
}
</script>

<template>
  <div>
    <div
      class="flex items-center gap-1 py-1 pr-2 rounded cursor-pointer text-sm"
      :class="isActive ? 'bg-(--ui-bg-accented) text-(--ui-text-highlighted)' : 'text-(--ui-text-muted) hover:bg-(--ui-bg-elevated)'"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
      @click="navigate(path)"
    >
      <button
        v-if="children === null || children.length > 0"
        class="flex items-center justify-center w-4 h-4 shrink-0"
        @click.stop="toggle"
      >
        <UIcon
          :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="text-(--ui-text-dimmed)"
        />
      </button>
      <span v-else class="w-4 h-4 shrink-0" />

      <UIcon name="i-lucide-folder" class="shrink-0" />
      <span class="truncate">{{ name }}</span>
    </div>

    <div v-if="expanded">
      <FilesFolderTreeNode
        v-for="child in children"
        :key="child"
        :path="path ? `${path}/${child}` : child"
        :name="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
