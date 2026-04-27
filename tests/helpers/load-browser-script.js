import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export function loadBrowserScriptExports(relativePath, exportNames, injections = {}) {
  const filePath = path.resolve(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');

  const scope = {
    window,
    document,
    console,
    fetch: globalThis.fetch,
    IntersectionObserver: globalThis.IntersectionObserver,
    ResizeObserver: globalThis.ResizeObserver,
    setTimeout,
    clearTimeout,
    URL,
    FormData,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    history: window.history,
    location: window.location,
    navigator: window.navigator,
    ...injections,
  };

  const factory = new Function(
    ...Object.keys(scope),
    `${source}\nreturn { ${exportNames.join(', ')} };`
  );

  return factory(...Object.values(scope));
}
