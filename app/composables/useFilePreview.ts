import type { FileRow } from './useFileList'

export function useFilePreview() {
  const isOpen = ref(false)
  const file = ref<FileRow | null>(null)

  function open(row: FileRow) {
    file.value = row
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  return { isOpen, file, open, close }
}
