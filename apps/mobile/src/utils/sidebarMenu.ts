// Which entries the left drawer shows, and to whom (CB-039).
//
// The drawer used to list the two admin screens for every sender, so a non-admin who tapped one landed on
// a 403. The gate is pure so it is covered by `sidebarMenu.spec.ts` without rendering the drawer; the
// admin flag itself comes from the cached `GET /auth/admin/me` result held in `AuthContext`.

export interface SidebarMenuItem {
  icon: string;
  label: string;
  path: string;
  /** Backed by an admin-only route: hidden from senders, who would otherwise be shown a 403 screen. */
  adminOnly?: boolean;
}

export const SIDEBAR_MENU_ITEMS: SidebarMenuItem[] = [
  { icon: 'H', label: 'Dashboard', path: '/(main)' },
  { icon: '+', label: 'Add receiver', path: '/(main)/receiver-setup' },
  { icon: 'O', label: 'Admin Operations', path: '/(main)/admin-operations', adminOnly: true },
  { icon: '!', label: 'Abuse Reports', path: '/(main)/admin-abuse-reports', adminOnly: true },
];

/**
 * The entries this sender may see. Admin entries appear only once the admin check has come back positive,
 * so the default (unknown, or a non-admin) shows the sender menu alone.
 */
export function visibleSidebarMenuItems(isAdmin: boolean): SidebarMenuItem[] {
  return SIDEBAR_MENU_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}
