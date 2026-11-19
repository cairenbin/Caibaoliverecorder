export const WORKBENCH_THEME_SETTING = 'workbench-color-theme';
export const DEFAULT_WORKBENCH_THEME = 'classic';
export const WORKBENCH_THEMES = Object.freeze([
  'classic', 'rose', 'blue', 'obsidian', 'silver', 'green', 'yellow',
]);

export function isWorkbenchTheme(value) {
  return WORKBENCH_THEMES.includes(value);
}

export function savedWorkbenchTheme(store) {
  const theme = store.setting(WORKBENCH_THEME_SETTING);
  return isWorkbenchTheme(theme) ? theme : DEFAULT_WORKBENCH_THEME;
}
