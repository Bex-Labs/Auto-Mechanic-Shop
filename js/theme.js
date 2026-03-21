/* =================================================================
   GEARSHIFT — THEME.JS
   Light / dark mode toggle with localStorage persistence
   Load this in every app page BEFORE main.js to avoid flash:
     <script src="../js/theme.js"></script>
   ================================================================= */

const Theme = (() => {

  const KEY = 'gs_theme';

  function isLight() {
    return localStorage.getItem(KEY) === 'light';
  }

  function apply(light) {
    if (light) {
      document.documentElement.classList.add('light-mode');
    } else {
      document.documentElement.classList.remove('light-mode');
    }
    // Update all toggle buttons on the page
    document.querySelectorAll('.theme-toggle-switch').forEach(btn => {
      btn.classList.toggle('light', light);
      btn.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    });
    document.querySelectorAll('.theme-toggle-label').forEach(el => {
      el.textContent = light ? '☀ Light' : '☾ Dark';
    });
  }

  function toggle() {
    const nowLight = !isLight();
    localStorage.setItem(KEY, nowLight ? 'light' : 'dark');
    apply(nowLight);
  }

  function init() {
    // Apply immediately to avoid flash of wrong theme
    apply(isLight());
    // Re-apply after DOM ready in case new toggle buttons were added
    document.addEventListener('DOMContentLoaded', () => apply(isLight()));
  }

  // Run immediately on script load
  init();

  return { toggle, isLight, apply };

})();
