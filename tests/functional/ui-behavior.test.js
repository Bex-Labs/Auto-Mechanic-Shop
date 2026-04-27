import { describe, expect, it, vi } from 'vitest';

import { loadBrowserScriptExports } from '../helpers/load-browser-script.js';

function loadUiHelpers() {
  return loadBrowserScriptExports(
    'js/main.js',
    ['renderAvatar', 'filterTable', 'switchPane'],
    { fetch: vi.fn() }
  );
}

describe('main.js UI behaviour', () => {
  it('shows initials when a staff member has no profile photo', () => {
    const { renderAvatar } = loadUiHelpers();
    const avatar = document.createElement('div');

    renderAvatar(avatar, 'Abbas Musa', '');

    expect(avatar.textContent).toBe('AM');
    expect(avatar.classList.contains('has-image')).toBe(false);
    expect(avatar.getAttribute('aria-label')).toBe('Abbas Musa avatar');
  });

  it('falls back to initials when a profile photo fails to load', () => {
    const { renderAvatar } = loadUiHelpers();
    const avatar = document.createElement('div');

    renderAvatar(avatar, 'Abbas Musa', 'https://example.com/broken-avatar.png');
    const image = avatar.querySelector('img');

    expect(image).not.toBeNull();
    image.onerror();

    expect(avatar.textContent).toBe('AM');
    expect(avatar.classList.contains('has-image')).toBe(false);
  });

  it('filters table rows based on what the user types', () => {
    const { filterTable } = loadUiHelpers();

    document.body.innerHTML = `
      <input id="partSearch">
      <table>
        <tbody id="inventoryRows">
          <tr><td>Brake Pad</td><td>BP-001</td></tr>
          <tr><td>Oil Filter</td><td>OF-002</td></tr>
        </tbody>
      </table>
    `;

    const input = document.getElementById('partSearch');
    const rows = document.querySelectorAll('#inventoryRows tr');

    filterTable('partSearch', 'inventoryRows', [0, 1]);
    input.value = 'oil';
    input.dispatchEvent(new Event('input'));

    expect(rows[0].style.display).toBe('none');
    expect(rows[1].style.display).toBe('');
  });

  it('switches the active settings pane when a different tab is selected', () => {
    const { switchPane } = loadUiHelpers();

    document.body.innerHTML = `
      <div class="app-sub-nav">
        <button id="tab-profile" class="app-sub-link active" data-pane="profilePane">Profile</button>
        <button id="tab-security" class="app-sub-link" data-pane="securityPane">Security</button>
      </div>
      <section id="profilePane" class="view-pane active">Profile pane</section>
      <section id="securityPane" class="view-pane">Security pane</section>
    `;

    const securityButton = document.getElementById('tab-security');
    switchPane(securityButton);

    expect(document.getElementById('tab-profile').classList.contains('active')).toBe(false);
    expect(securityButton.classList.contains('active')).toBe(true);
    expect(document.getElementById('profilePane').classList.contains('active')).toBe(false);
    expect(document.getElementById('securityPane').classList.contains('active')).toBe(true);
  });
});
