<template><div/></template>
<script setup lang="ts">
import type { UsedInVue } from './types'

interface VueLocal {
  x: number
}

defineProps<{ item: UsedInVue }>()
</script>
