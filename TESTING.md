# Testing Guide

This project uses `Vitest` because it is already installed, runs fast, and works well for both unit tests and browser-like functional tests with `jsdom`.

## What is covered

- `tests/unit/main-helpers.test.js`
  Tests shared helpers from `js/main.js` such as initials, currency formatting, and ID generation.
- `tests/unit/billing-plan.test.js`
  Tests the live Starter vs Pro plan rules from `js/billing.js`.
- `tests/functional/ui-behavior.test.js`
  Tests user-visible DOM behaviour like avatar fallback, table filtering, and pane switching.
- `tests/work-orders.test.js`
  Covers the work-order flow: create, update, attach parts, deduct stock, and generate invoices.

## Run the tests

1. Open the project folder in your terminal.
2. Install packages once:

```bash
npm install
```

3. Run the full suite:

```bash
npm test
```

4. Run only the unit tests:

```bash
npm run test:unit
```

5. Run only the functional tests:

```bash
npm run test:functional
```

6. Run tests in watch mode while you edit:

```bash
npm run test:watch
```

7. Generate a coverage report:

```bash
npm run test:coverage
```

After coverage finishes, open `coverage/index.html` in your browser to see which parts of the test suite are covered.

## How to add a new unit test slowly

1. Pick one small function you want to protect.
2. Create a file inside `tests/unit/`.
3. Import `describe`, `it`, and `expect` from `vitest`.
4. If the code lives in a browser script, use `tests/helpers/load-browser-script.js` to load the real function from the app file.
5. Write one happy-path test first.
6. Add one edge-case test next.
7. Run only unit tests and confirm they pass.

Example shape:

```js
import { describe, it, expect } from 'vitest';

describe('my feature', () => {
  it('does the expected thing', () => {
    expect(true).toBe(true);
  });
});
```

## How to add a new functional test slowly

1. Choose one user action in the app, like clicking a tab or filtering a table.
2. Create a file inside `tests/functional/`.
3. Build only the minimal HTML needed in `document.body`.
4. Load the real browser helper or function you want to exercise.
5. Simulate the user action with `click()`, `dispatchEvent()`, or direct function calls.
6. Assert what the user should see in the DOM.

## Suggested presentation flow

1. Explain that unit tests protect small business rules and helper functions.
2. Explain that functional tests protect user-visible behaviour and workflow logic.
3. Run `npm run test:unit`.
4. Run `npm run test:functional`.
5. If needed, run `npm run test:coverage` to show reporting output.
