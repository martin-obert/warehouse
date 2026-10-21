<script setup lang="ts">
const query = defineModel<string>({ required: true })
</script>

<template>
  <UInput
    v-model="query"
    icon="i-lucide-search"
    placeholder="Search files…"
    class="flex-1 max-w-md"
  >
    <template v-if="query.length > 0" #trailing>
      <UButton
        icon="i-lucide-x"
        variant="ghost"
        color="neutral"
        size="xs"
        @click="query = ''"
      />
    </template>
  </UInput>
</template>
