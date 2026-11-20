// The workspace rules of the brief (functions 10 to 12; briefs README, "M3: the reused plugins in a
// workspace"): the workspace shown decides who may edit and which layers are the plugin's to write
// into.
import { PERMISSIONS, VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import type { PluginContext, WorkspaceInfo } from '@emc2/plugin-sdk';

/** The workspace shown. */
export function shownWorkspace(ctx: PluginContext): WorkspaceInfo {
  return ctx.workspace.current;
}

/** The workspaces this user may see, View first. */
export function knownWorkspaces(ctx: PluginContext): readonly WorkspaceInfo[] {
  return ctx.workspaces;
}

/** What editing objects needs in a workspace: its `editPermission`, or `objects.edit` in View, which has none (rule 4). */
export function editPermissionOf(workspace: WorkspaceInfo): string {
  return workspace.editPermission ?? PERMISSIONS.objectsEdit;
}

/** "You may not edit objects", with the workspace's name when it is not View (function 12). */
export function readOnlyHint(workspace: WorkspaceInfo): string {
  return workspace.id === VIEW_WORKSPACE ? 'You may not edit objects' : `You may not edit objects in ${workspace.name}`;
}

/** The hint of a selected shape that is not in the workspace's layers (function 11). */
export function notInWorkspaceHint(workspace: WorkspaceInfo): string {
  return `This graphic is not in ${workspace.name}`;
}
