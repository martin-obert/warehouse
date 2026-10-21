<script setup lang="ts">
import type { FileRow } from '~/composables/useFileList'
import type { SearchHit } from '~/composables/useSearch'

defineProps<{
  hits: SearchHit[]
  loading: boolean
}>()

const emit = defineEmits<{
  select: [file: FileRow]
}>()

function parseSnippet(snippet: string): { text: string, marked: boolean }[] {
  return snippet.split(/[\x01\x02]/).map((text, i) => ({ text, marked: i % 2 === 1 }))
}
</script>

<template>
  <div class="divide-y divide-(--ui-border)">
    <div
      v-for="hit in hits"
      :key="hit.id"
      class="flex items-start gap-3 py-3 px-1 cursor-pointer hover:bg-(--ui-bg-elevated)"
      @click="emit('select', hit)"
    >
      <FilesThumbnail :file="hit" />
      <div class="min-w-0">
        <p class="text-sm text-(--ui-text-highlighted) truncate">{{ hit.path }}</p>
        <p v-if="hit.snippet" class="text-sm text-(--ui-text-muted) truncate">
          <template v-for="(part, i) in parseSnippet(hit.snippet)" :key="i">
            <mark v-if="part.marked" class="bg-(--ui-primary)/30 text-(--ui-text-highlighted) rounded px-0.5">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </p>
      </div>
    </div>

    <p v-if="!loading && hits.length === 0" class="py-8 text-center text-sm text-(--ui-text-dimmed)">
      No results
    </p>
  </div>
</template>
