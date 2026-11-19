<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { Palette } from 'lucide-vue-next';
import { ui } from '../../shared/ui-copy.js';
import { WORKBENCH_THEMES } from '../../shared/workbench-theme.js';

const props = defineProps({ theme: { type: String, required: true }, saving: Boolean });
const emit = defineEmits(['select']);
const root = ref(null);
const trigger = ref(null);
const opened = ref(false);

async function toggle() {
  opened.value = !opened.value;
  if (!opened.value) return;
  await nextTick();
  const current = root.value?.querySelector('[aria-pressed="true"]:not(:disabled)');
  current?.focus();
}

function close(returnFocus = false) {
  opened.value = false;
  if (returnFocus) trigger.value?.focus();
}

function pick(theme) {
  if (props.saving) return;
  if (theme !== props.theme) emit('select', theme);
  close(true);
}

function outside(event) {
  if (opened.value && !root.value?.contains(event.target)) close();
}

function onKey(event) {
  if (event.key !== 'Escape' || !opened.value) return;
  event.preventDefault();
  close(true);
}

onMounted(() => {
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', outside);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside);
  document.removeEventListener('focusin', outside);
});
</script>

<template>
  <div ref="root" class="workbench-theme-picker" @keydown.stop="onKey">
    <button ref="trigger" type="button" class="button subtle theme-trigger"
      :aria-label="ui.workbench.theme.title" :title="ui.workbench.theme.title"
      :aria-expanded="opened" aria-controls="workbench-theme-options" @click="toggle">
      <Palette :size="16" aria-hidden="true"/>
    </button>
    <div v-show="opened" id="workbench-theme-options" class="theme-options" role="group" :aria-label="ui.workbench.theme.title">
      <button v-for="id in WORKBENCH_THEMES" :key="id" type="button"
        class="theme-option" :aria-label="ui.workbench.theme[id]" :aria-pressed="theme===id"
        :disabled="saving" @click="pick(id)">
        <span class="theme-swatch" :data-workbench-theme="id" aria-hidden="true"/>
      </button>
    </div>
  </div>
</template>
