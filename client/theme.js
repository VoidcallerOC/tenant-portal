const THEME_KEY = 'portal-theme';

function preferredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function labelFor(theme) {
  return theme === 'dark' ? 'Light mode' : 'Dark mode';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.textContent = labelFor(theme);
    button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  });
}

applyTheme(preferredTheme());

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-theme-toggle]');
  if (!button) return;
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
