// Quick run: @harness @login
import { expect, test } from '@playwright/test';
import { TEST_REALM_PREFIX, testRealmName, testRealmTime } from '../../lib/login';

// The login specs' realm names (T-124): one per spec file and run, unique, carrying the time it was
// made, so that a later run can delete a killed run's realm and no other. No Keycloak needed.

test('a test realm name is new each time, carries its UTC time to the second, and only such names are read as test realms', () => {
  const now = new Date(Date.UTC(2026, 9, 31, 10, 15, 42, 900));
  const names = Array.from({ length: 20 }, () => testRealmName(now));
  expect(new Set(names).size, 'unique').toBe(20);
  for (const name of names) {
    expect(name).toMatch(/^emc2-ita-20261031-101542-[0-9a-f]{8}$/);
    expect(name.startsWith(TEST_REALM_PREFIX)).toBe(true);
    expect(testRealmTime(name)).toBe(Date.UTC(2026, 9, 31, 10, 15, 42));
  }
  for (const other of ['emc2-ita', 'emc2-demo', 'master', 'emc2', 'emc2-ita-20261031-101542', 'emc2-ita-20261031-101542-3F9A0C1D', 'x-emc2-ita-20261031-101542-3f9a0c1d']) {
    expect(testRealmTime(other), other).toBeNull();
  }
});
