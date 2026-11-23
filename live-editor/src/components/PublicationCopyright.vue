<script setup>
import { ui } from '../../shared/ui-copy.js';

defineProps({ fieldPrefix: { type: String, required: true }, required: Boolean, disabled: Boolean });
const copyright = defineModel('copyright', { type: [String, Number], required: true });
const source = defineModel('source', { type: String, required: true });
const copy = ui.autoPost;
</script>

<template>
  <label class="field-label" :for="fieldPrefix + '-copyright'">
    {{ copy.投稿类型 }}
    <select :id="fieldPrefix + '-copyright'" v-model="copyright" :disabled="disabled" :required="required">
      <option value="" disabled>{{ copy.选择投稿类型 }}</option>
      <option :value="1">{{ copy.自制 }}</option>
      <option :value="2">{{ copy.转载 }}</option>
    </select>
  </label>
  <label v-if="copyright === 2" class="field-label" :for="fieldPrefix + '-source'">
    {{ copy.转载来源 }}
    <input :id="fieldPrefix + '-source'" v-model="source" maxlength="200" :placeholder="copy.转载来源提示" :disabled="disabled" :required="required"/>
  </label>
</template>

<style scoped>
select { width: 100%; height: 40px; padding: 0 10px; color: var(--text); background: var(--input); border: 1px solid var(--line-strong); border-radius: var(--radius-control); font: inherit; }
</style>
