<script setup>
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue';
import { ui } from '../../shared/ui-copy.js';
import { api } from '../api.js';

const props = defineProps({
  accountUid: { type: String, default: '' },
  disabled: Boolean,
});
const model = defineModel({ type: String, required: true });
const emit = defineEmits(['valid']);
const copy = ui.autoPost;
const categories = ref([]);
const parentId = ref('');
const loading = ref(false);
const error = ref('');
let request;

const savedGroup = computed(() => categories.value.find(group => group.children.some(child => child.id === model.value)));
const group = computed(() => savedGroup.value ?? categories.value.find(option => option.id === parentId.value));
const children = computed(() => group.value?.children ?? []);
watchEffect(() => emit('valid', !!savedGroup.value));

function chooseParent(event) {
  parentId.value = event.target.value;
  model.value = '';
}

async function load() {
  request?.abort();
  categories.value = [];
  parentId.value = '';
  error.value = '';
  loading.value = !!props.accountUid;
  if (!props.accountUid) return;
  const controller = new AbortController();
  request = controller;
  try {
    const result = await api('bilibili-publication-categories', undefined, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    });
    if (!controller.signal.aborted) categories.value = result.categories;
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause.message;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}

watch(() => props.accountUid, load, { immediate: true });
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <fieldset class="field-label publication-category" :disabled="disabled">
    <legend>{{ copy.投稿分区 }}</legend>
    <div class="category-options">
      <select :value="group?.id ?? ''" :aria-label="copy.选择主分区" :disabled="!categories.length" @change="chooseParent">
        <option value="" disabled>{{ copy.选择主分区 }}</option>
        <option v-for="option in categories" :key="option.id" :value="option.id">{{ option.name }}</option>
      </select>
      <select :value="savedGroup ? model : ''" :aria-label="copy.请选择投稿分区" :disabled="!children.length" @change="model = $event.target.value">
        <option value="" disabled>{{ copy.请选择投稿分区 }}</option>
        <option v-for="option in children" :key="option.id" :value="option.id">{{ option.name }}</option>
      </select>
    </div>
    <small v-if="loading" role="status">{{ copy.读取投稿分区 }}</small>
    <div v-else-if="error" class="category-error">
      <small role="alert">{{ error }}</small>
      <button type="button" class="button" @click="load">{{ copy.重新读取投稿分区 }}</button>
    </div>
    <small v-else-if="categories.length && model && !savedGroup" role="status">{{ copy.原投稿分区不可用 }}</small>
  </fieldset>
</template>

<style scoped>
.publication-category { min-width: 0; border: 0; padding: 0; }
.publication-category legend { padding: 0; margin-bottom: 5px; }
.category-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.category-error { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
select { width: 100%; min-width: 0; height: 40px; padding: 0 10px; color: var(--text); background: var(--input); border: 1px solid var(--line-strong); border-radius: var(--radius-control); font: inherit; }
</style>
