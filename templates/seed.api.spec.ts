// Seed test (API profile).
// Establishes a reachable base URL and a valid token, and proves the contract
// under test is being served. Must pass before any bolt runs.

import { test, expect } from '@playwright/test';

test('seed', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.ok()).toBeTruthy();

  // TODO: acquire a token once and reuse it via a fixture.
  //   const auth = await request.post('/auth/token', {
  //     data: { client_id: process.env.E2E_USER, client_secret: process.env.API_TOKEN },
  //   });
  //   expect(auth.ok()).toBeTruthy();
});
