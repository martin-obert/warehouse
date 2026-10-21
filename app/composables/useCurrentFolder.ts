export function useCurrentFolder() {
  const route = useRoute()
  const router = useRouter()

  const path = computed(() => (typeof route.query.path === 'string' ? route.query.path : ''))

  function navigate(newPath: string) {
    router.push({ query: { ...route.query, path: newPath || undefined } })
  }

  return { path, navigate }
}
