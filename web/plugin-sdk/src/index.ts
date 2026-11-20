/**
 * The emc2 web plugin SDK: the only API a plugin's web part uses (ADR-0008, docs/plugins/sdk-v1.md).
 * Shared through the shell's import map; plugins never bundle it.
 *
 * @example
 * import { definePlugin, SYMBOLS } from '@emc2/plugin-sdk';
 */
export * from './context.ts';
export * from './services.ts';
export * from './model.ts';
export * from './workspace.ts';
export * from './actions.ts';
export * from './objects.ts';
export * from './userDocuments.ts';
export * from './theme.ts';
export * from './fields.ts';
export * from './sets.ts';
export * from './time.ts';
export * from './display.ts';
export * from './categories.ts';
export * from './settings-form.ts';
export * from './palettes.ts';
export * from './fade.ts';
export * from './stream.ts';
export * from './components/index.tsx';
export type { Unsubscribe } from './events.ts';
export { SDK_VERSION, SHARED_LIBRARIES, compatibleShared, satisfies } from './version.ts';
export { uuidv7 } from './ids.ts';
export { canonicalSidc } from './sidc.ts';
