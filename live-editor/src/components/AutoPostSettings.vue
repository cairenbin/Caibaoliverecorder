<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { LoaderCircle } from 'lucide-vue-next';
import { ui } from '../../shared/ui-copy.js';
import { POST_DATE_TOKEN, renderAutoPostTitle } from '../../shared/auto-post-title.js';
import { api } from '../api.js';

const props = defineProps({ anchor: { type: Object, required: true }, simulation: Boolean });
const emit = defineEmits(['busy', 'saved', 'close']);
const copy = ui.autoPost;
const modes = [
  { id: 'danmaku', label: copy.仅弹幕版 },
  { id: 'clean', label: copy.仅纯净版 },
  { id: 'dual', label: copy.双版本分P },
];
const today = new Date();
const route = `anchors/${encodeURIComponent(props.anchor.key)}/auto-post`;
const enabled = ref(false);
const titleTemplate = ref('');
const description = ref('');
const homepage = ref('');
const tagsText = ref('');
const categoryId = ref('');
const mode = ref('danmaku');
const account = ref('');
const titleInput = ref(null);
const enableInput = ref(null);
const loading = ref(true);
const loaded = ref(false);
const saving = ref(false);
const error = ref('');
const request = new AbortController();
const preview = computed(() => renderAutoPostTitle(titleTemplate.value, today));
const tags = computed(() => [...new Set(tagsText.value.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))]);
const validationError = computed(() => tags.value.length > 10 ? copy.标签过多
  : enabled.value && [...preview.value].length > 80 ? copy.标题过长 : '');
const valid = computed(() => !validationError.value && (!enabled.value || !!preview.value));

onMounted(async () => {
  try {
    const settings = await api(route, undefined, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
    });
    if (request.signal.aborted) return;
    enabled.value = settings.enabled === true;
    titleTemplate.value = settings.titleTemplate || '';
    description.value = settings.description || '';
    homepage.value = settings.homepage || '';
    tagsText.value = (settings.tags ?? []).join('，');
    categoryId.value = settings.categoryId ?? '';
    mode.value = modes.some(option => option.id === settings.mode) ? settings.mode : 'danmaku';
    account.value = settings.account?.name || settings.account?.uid || '';
    loaded.value = true;
  } catch (cause) {
    if (!request.signal.aborted) error.value = cause.message;
  } finally {
    loading.value = false;
  }
  if (loaded.value) {
    await nextTick();
    enableInput.value?.focus();
  }
});
onBeforeUnmount(() => request.abort());

async function insertDate() {
  const input = titleInput.value;
  const start = input.selectionStart ?? titleTemplate.value.length;
  const end = input.selectionEnd ?? start;
  const value = titleTemplate.value.slice(0, start) + POST_DATE_TOKEN + titleTemplate.value.slice(end);
  if (value.length > input.maxLength) return;
  titleTemplate.value = value;
  await nextTick();
  input.focus();
  input.setSelectionRange(start + POST_DATE_TOKEN.length, start + POST_DATE_TOKEN.length);
}

async function save() {
  if (!loaded.value || !valid.value || saving.value) return;
  saving.value = true;
  emit('busy', true);
  error.value = '';
  let saved = false;
  try {
    await api(route, {
      enabled: enabled.value,
      titleTemplate: titleTemplate.value.trim(),
      description: description.value.trim(),
      homepage: homepage.value.trim(),
      tags: tags.value,
      categoryId: categoryId.value,
      mode: mode.value,
    }, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) });
    saved = true;
  } catch (cause) {
    if (!request.signal.aborted) error.value = cause.message;
  } finally {
    saving.value = false;
    emit('busy', false);
  }
  if (saved) emit('saved');
}
</script>

<template>
  <div v-if="simulation" class="auto-post-note" role="note">
    <strong>{{ copy.模拟标题 }}</strong>
    <span>{{ copy.模拟说明 }}</span>
  </div>
  <p v-if="loading" role="status">{{ copy.读取中 }}</p>
  <p v-if="error && !loaded" class="inline-warning" role="alert">{{ error }}</p>
  <form v-if="loaded" class="auto-post-settings" @submit.prevent="save">
    <label class="checkbox auto-post-toggle">
      <input ref="enableInput" v-model="enabled" type="checkbox" :disabled="saving"/>
      {{ copy.启用 }}
    </label>
    <p v-if="account" class="muted">{{ copy.投稿账号(account) }}</p>

    <div class="auto-post-fields">
      <div class="field-label">
        <label for="auto-post-title">{{ copy.标题格式 }}</label>
        <div class="auto-post-title-editor">
          <input id="auto-post-title" ref="titleInput" v-model="titleTemplate" maxlength="160" :required="enabled" :disabled="saving"/>
          <button type="button" class="button" :disabled="saving" @click="insertDate">{{ copy.插入录制日期 }}</button>
        </div>
        <div class="auto-post-preview">
          <small id="auto-post-preview-label">{{ copy.今日标题预览 }}</small>
          <output id="auto-post-preview" for="auto-post-title" aria-labelledby="auto-post-preview-label">{{ preview || copy.预览为空 }}</output>
          <small>{{ copy.日期说明 }}</small>
        </div>
      </div>
      <label class="field-label" for="auto-post-description">
        {{ copy.简介 }}
        <textarea id="auto-post-description" v-model="description" rows="2" maxlength="2000" :disabled="saving"/>
      </label>
      <label class="field-label" for="auto-post-homepage">
        {{ copy.主播主页 }}
        <input id="auto-post-homepage" v-model="homepage" type="url" maxlength="500" :disabled="saving"/>
        <small>{{ copy.主播主页说明 }}</small>
      </label>
      <label class="field-label" for="auto-post-tags">
        {{ copy.标签 }}
        <input id="auto-post-tags" v-model="tagsText" maxlength="200" :disabled="saving" :placeholder="copy.标签分隔"/>
      </label>
      <label v-if="!simulation" class="field-label" for="auto-post-category">
        {{ copy.投稿分区 }}
        <input id="auto-post-category" v-model="categoryId" type="number" min="1" step="1" :disabled="saving"/>
      </label>
    </div>

    <fieldset class="auto-post-versions" :disabled="saving">
      <legend>{{ copy.投稿版本 }}</legend>
      <label v-for="option in modes" :key="option.id" class="checkbox">
        <input v-model="mode" type="radio" name="auto-post-mode" :value="option.id"/>
        {{ option.label }}
      </label>
      <p v-if="mode === 'dual'" class="muted">{{ copy.分P预览 }}</p>
    </fieldset>
    <p v-if="validationError || error" class="inline-warning" role="alert">{{ validationError || error }}</p>
    <div class="confirm-actions">
      <button type="button" class="button" :disabled="saving" @click="emit('close')">{{ ui.common.取消 }}</button>
      <button type="submit" class="button primary" :disabled="saving || !valid">
        <LoaderCircle v-if="saving" :size="16" class="spin" aria-hidden="true"/>
        {{ saving ? ui.common.正在保存 : copy.保存 }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.auto-post-note { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px 12px; margin: 10px 0 16px; color: var(--muted); font-size: 12px; }
.auto-post-note strong { color: var(--accent-dark); }
.auto-post-toggle { color: var(--text); }
.auto-post-fields .field-label { margin-block: 12px; }
.auto-post-title-editor { display: flex; gap: 8px; }
.auto-post-title-editor input { min-width: 0; }
.auto-post-title-editor .button { flex-shrink: 0; }
.auto-post-preview { display: grid; gap: 4px; padding: 9px 12px; background: var(--stage-glow); border: 1px solid var(--line); border-radius: var(--radius-control); }
.auto-post-preview output { overflow-wrap: anywhere; color: var(--text); font-weight: 600; }
textarea { width: 100%; min-height: 64px; resize: vertical; color: var(--text); background: var(--input); border: 1px solid var(--line-strong); border-radius: var(--radius-control); padding: 8px 10px; font: inherit; }
.auto-post-versions { display: flex; flex-wrap: wrap; gap: 6px 14px; min-width: 0; margin: 0; padding: 10px 0 0; border: 0; }
.auto-post-versions legend { font-size: 12px; color: var(--muted); }
.auto-post-versions p { flex-basis: 100%; margin: 0; }
@media (max-width: 420px) { .auto-post-title-editor { align-items: flex-start; flex-direction: column; } }
</style>
