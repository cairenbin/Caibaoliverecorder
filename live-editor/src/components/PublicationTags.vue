<script setup>
import { ref, watch } from 'vue';
import { ui } from '../../shared/ui-copy.js';
import { MAX_PUBLICATION_TAGS, MAX_PUBLICATION_TAG_LENGTH, publicationTagError } from '../../shared/publication-tags.js';

defineProps({ inputId: { type: String, required: true }, disabled: Boolean });
const tags = defineModel({ type: Array, required: true });
const copy = ui.autoPost;
const draft = ref('');
const error = ref('');
const input = ref(null);
watch(draft, () => { error.value = ''; });

function commit() {
  const value = draft.value.trim();
  if (!value) return true;
  const next = [...tags.value, value];
  error.value = tags.value.includes(value) ? copy.标签已添加 : publicationTagError(next);
  if (error.value) {
    input.value?.focus();
    return false;
  }
  tags.value = next;
  draft.value = '';
  return true;
}

function enter(event) {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  commit();
}

function remove(index) {
  tags.value = tags.value.filter((_, position) => position !== index);
  error.value = '';
  input.value?.focus();
}

defineExpose({ commit });
</script>

<template>
  <div class="field-label publication-tags">
    <label :for="inputId">{{ copy.标签 }} · {{ tags.length }}/{{ MAX_PUBLICATION_TAGS }}</label>
    <div v-if="tags.length" class="publication-tag-list">
      <button v-for="(tag, index) in tags" :key="tag" class="publication-tag" type="button"
        :disabled="disabled" :aria-label="copy.移除标签(tag)" @click="remove(index)">
        <span>{{ tag }}</span><span aria-hidden="true">×</span>
      </button>
    </div>
    <div class="publication-tag-entry">
      <input :id="inputId" ref="input" v-model="draft" :disabled="disabled"
        :placeholder="copy.标签分隔" :aria-describedby="inputId + '-count'" :aria-invalid="!!error"
        @keydown.enter.stop="enter"/>
      <button class="button" type="button" :disabled="disabled || !draft.trim()" @click="commit(); input?.focus()">{{ copy.添加标签 }}</button>
    </div>
    <small :id="inputId + '-count'">{{ copy.标签字符数(draft.trim().length, MAX_PUBLICATION_TAG_LENGTH) }}</small>
    <small v-if="error" class="inline-warning" role="alert">{{ error }}</small>
  </div>
</template>

<style scoped>
.publication-tag-list, .publication-tag-entry { display: flex; gap: 6px; }
.publication-tag-list { flex-wrap: wrap; }
.publication-tag { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; padding: 3px 8px; border: 1px solid var(--line-strong); border-radius: 8px; color: var(--text); background: var(--input); font: inherit; }
.publication-tag span:first-child { overflow-wrap: anywhere; text-align: left; }
.publication-tag-entry input { min-width: 0; }
.publication-tag-entry .button { flex: none; }
</style>
