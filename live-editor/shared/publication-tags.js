import { ui } from './ui-copy.js';

export const MAX_PUBLICATION_TAGS = 10;
export const MAX_PUBLICATION_TAG_LENGTH = 20;

export function publicationTagError(tags, { required = true, legacy = false } = {}) {
  const copy = ui.autoPost;
  if (required && !tags.length) return copy.请填标签;
  if (tags.length > MAX_PUBLICATION_TAGS) return copy.标签过多;
  if (tags.some(tag => !tag || /[\x00-\x1f\x7f]/.test(tag))) return copy.标签内容无效;
  if (tags.some(tag => tag.includes(','))) return copy.标签英文逗号;
  if (!legacy && tags.some(tag => tag.length > MAX_PUBLICATION_TAG_LENGTH)) return copy.单个标签过长;
  if (tags.join(',').length > 200) return copy.标签总长过长;
  return '';
}

export function normalizePublicationTags(input, options) {
  if (!Array.isArray(input) || input.length > 100 || input.some(tag => typeof tag !== 'string')) {
    throw new Error(ui.autoPost.标签内容无效);
  }
  const tags = [...new Set(input.map(tag => tag.trim()).filter(Boolean))];
  const error = publicationTagError(tags, options);
  if (error) throw new Error(error);
  return tags;
}
