<script setup lang="ts">
const { path } = useCurrentFolder()

const items = computed(() => {
  const segments = path.value ? path.value.split('/') : []
  let acc = ''
  return [
    { label: 'Home', to: { query: { path: undefined } } },
    ...segments.map((name) => {
      acc = acc ? `${acc}/${name}` : name
      return { label: name, to: { query: { path: acc } } }
    }),
  ]
})
</script>

<template>
  <UBreadcrumb :items="items" />
</template>
