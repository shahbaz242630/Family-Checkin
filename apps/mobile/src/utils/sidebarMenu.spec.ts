import { describe, expect, it } from 'vitest';

import { SIDEBAR_MENU_ITEMS, visibleSidebarMenuItems } from './sidebarMenu';

const ADMIN_PATHS = ['/(main)/admin-operations', '/(main)/admin-abuse-reports'];

describe('visibleSidebarMenuItems', () => {
  it('hides every admin entry from a sender (CB-039: tapping one returned a 403 screen)', () => {
    const paths = visibleSidebarMenuItems(false).map((item) => item.path);

    expect(paths).toEqual(['/(main)', '/(main)/receiver-setup']);
    for (const adminPath of ADMIN_PATHS) {
      expect(paths).not.toContain(adminPath);
    }
  });

  it('shows the admin entries to an admin', () => {
    const paths = visibleSidebarMenuItems(true).map((item) => item.path);

    expect(paths).toEqual(['/(main)', '/(main)/receiver-setup', ...ADMIN_PATHS]);
  });

  it('keeps the sender entries in the same order for both', () => {
    const senderPaths = visibleSidebarMenuItems(false).map((item) => item.path);
    const adminPaths = visibleSidebarMenuItems(true).map((item) => item.path);

    expect(adminPaths.slice(0, senderPaths.length)).toEqual(senderPaths);
  });

  it('marks exactly the admin-only routes, so a new entry has to opt in', () => {
    const adminOnly = SIDEBAR_MENU_ITEMS.filter((item) => item.adminOnly).map((item) => item.path);

    expect(adminOnly).toEqual(ADMIN_PATHS);
  });

  it('does not mutate the source list', () => {
    const before = SIDEBAR_MENU_ITEMS.length;

    visibleSidebarMenuItems(false);
    visibleSidebarMenuItems(true);

    expect(SIDEBAR_MENU_ITEMS).toHaveLength(before);
  });
});
