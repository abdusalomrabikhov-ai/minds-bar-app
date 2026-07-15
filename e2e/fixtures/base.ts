import { test as base, expect } from '@playwright/test';
import { getBaseUrl } from '../helpers/env-config';

type TeamTaskFixtures = {
  baseUrl: string;
  apiRequest: (method: string, path: string, body?: unknown) => Promise<unknown>;
};

export const test = base.extend<TeamTaskFixtures>({
  baseUrl: async ({}, use) => {
    await use(getBaseUrl());
  },

  apiRequest: async ({ request }, use) => {
    const baseUrl = getBaseUrl();
    const helper = async (method: string, path: string, body?: unknown) => {
      const url = `${baseUrl}/api${path}`;
      const opts = {
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { data: body } : {}),
      };
      const resp = method === 'GET'
        ? await request.get(url, opts)
        : method === 'POST'
        ? await request.post(url, opts)
        : method === 'PUT'
        ? await request.put(url, opts)
        : await request.delete(url, opts);
      return resp.json();
    };
    await use(helper);
  },
});

export { expect };
