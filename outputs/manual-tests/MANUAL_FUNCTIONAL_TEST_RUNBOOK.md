# Manual Functional Test Runbook

This runbook is for proper browser-based functionality testing of the GearShift app without reading or running code.

## 1. Before You Start

Prepare these first:

- A clean browser like Chrome or Edge
- A stable internet connection
- The app URL
- The public booking link
- Test accounts for:
  - `Admin`
  - `Mechanic`
  - `Service Advisor`
  - `Parts Manager`
- A safe test environment if you plan to use `Reset Demo Data` or `Delete Account`

## 2. Open The Test Case Sheet

Use this file:

- `outputs/manual-tests/GearShift_Manual_Functional_Test_Cases.tsv`

Open it in Excel by:

1. Opening Excel
2. Choosing `Open`
3. Selecting the `.tsv` file

Excel will place each test-case field into its own column automatically.

## 3. Add Your Execution Columns If Needed

The template already includes the main fields, but you can add these if your superiors want more detail:

- `Tester Name`
- `Test Date`
- `Environment`
- `Browser`
- `Device`
- `Severity`

## 4. Recommended Test Order

Run the test cases in this order:

1. Authentication
2. Role permissions
3. Online booking
4. Appointments
5. Customers
6. Work Orders
7. Invoices
8. Inventory
9. Supply Chain
10. Reports
11. Settings and Notifications
12. Staff activity
13. Mobile and tablet checks

This order helps you avoid testing later features with broken setup data.

## 5. How To Execute Each Test Case

For every row in the sheet:

1. Read the `Precondition`
2. Follow the `Steps` exactly in the browser
3. Compare what happened with the `Expected Result`
4. Write what actually happened in `Actual Result`
5. Mark `Status` as:
   - `Pass`
   - `Fail`
   - `Blocked`
6. Save a screenshot or screen recording for every `Fail`
7. Add anything important in `Notes`

## 6. How To Mark Results Properly

Use these rules:

- `Pass`: The feature worked exactly as expected
- `Fail`: The feature behaved incorrectly, incompletely, or broke
- `Blocked`: You could not complete the test because another issue stopped you

Do not mark something as Pass just because part of it worked. If the expected result was not fully achieved, mark it as Fail.

## 7. What Evidence To Capture

For every failed or blocked test, capture:

- Screenshot
- Screen recording if needed
- Test ID
- Account used
- Browser/device used
- Exact page where it failed

Good evidence makes retesting and reporting much easier.

## 8. Device Coverage

Run the most important tests on:

- Desktop
- Tablet
- Mobile

Minimum desktop checks:

- Login
- Dashboard
- Customers
- Appointments
- Work Orders
- Invoices
- Reports
- Settings

Minimum mobile/tablet checks:

- Login
- Public booking page
- Dashboard navigation
- Work Orders
- Invoices
- Settings

## 9. Role Coverage

Make sure you test with different roles:

- `Admin`: full access
- `Mechanic`: work-focused access
- `Service Advisor`: customer and workflow access
- `Parts Manager`: inventory and supply chain access

Pay special attention to:

- Revenue visibility
- Staff-management access
- Settings restrictions
- Reports access
- Notification behavior

## 10. Bug Logging Format

If you find an issue, log it in this format:

- `Bug ID`: BUG-001
- `Title`: Short name of the problem
- `Module`: Example `Work Orders`
- `Steps To Reproduce`: Exact steps used
- `Expected Result`: What should have happened
- `Actual Result`: What actually happened
- `Severity`:
  - `Critical`
  - `High`
  - `Medium`
  - `Low`
- `Screenshot`: file name or link

## 11. End-Of-Test Summary

After executing the sheet, create a small summary like this:

- `Total Tests`: number of rows executed
- `Passed`: count
- `Failed`: count
- `Blocked`: count
- `Critical Issues`: count
- `High Issues`: count
- `Overall Readiness`: Ready / Conditionally Ready / Not Ready

Suggested readiness rule:

- `Ready`: No critical issues and only minor defects remain
- `Conditionally Ready`: No critical issues, but some high issues remain
- `Not Ready`: Any critical issue exists or many high issues remain

## 12. Presentation Flow

If you are presenting results:

1. Explain the test scope
2. Explain which roles, browsers, and devices were used
3. Show total tests executed
4. Show pass/fail numbers
5. Highlight critical or high issues
6. Show screenshots for the top failures
7. End with overall readiness

## 13. Important Safety Note

Run these only in a safe test environment unless you intentionally want live changes:

- `SET-006` Reset Demo Data
- `SET-007` Delete Account

## 14. Fastest Practical Way To Use This

If you want to move quickly:

1. Execute all `Critical` tests first
2. Then execute all `High` tests
3. Then run the `Medium` tests
4. Leave the destructive test cases for the end

That gives you a strong readiness assessment even if time is limited.
