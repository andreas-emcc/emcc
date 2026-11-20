// T-204 (M8; SDK 1.8.0 parts C and D, CR-0043): name once and an icon for every panel, a panel foot
// where the actions apply to the whole body, the manifest's icon and the settings schema's hints.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fieldHint, fieldWidth, formSections, pluginIcon, PLUGIN_ICONS, settingsHintsProblem } from '@emc2/plugin-sdk';
import type { SettingsSchema } from '@emc2/plugin-sdk';
import manifest from '../../plugin.json' with { type: 'json' };
import { activated, feedPicture, groups, panel, route, ROUTE_A, routeInfo, SIM_LAYER, symbol, TRACK_1 } from './harness.tsx';

afterEach(() => {
  cleanup();
});

const TITLES: Readonly<Record<string, string>> = {
  routes: 'Routes',
  'route-editor': 'Route editor',
  event: 'Event',
  outputs: 'Ground truth outputs',
  sensors: 'Sensors',
};

describe('the panels (SDK 1.8.0 part C)', () => {
  it('each panel of Simulation has an icon and draws no heading repeating its title', async () => {
    const rig = await activated({ symbols: true });
    feedPicture(rig.ctx, [route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1), points: [{ speed: 8.33 }, { speed: 8.33 }] }), symbol(TRACK_1, SIM_LAYER)]);
    rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha') });
    await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
    const Editor = panel(rig.ctx, 'route-editor');
    render(<Editor />);
    await screen.findByRole('region', { name: 'Point 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Add event at point 1' }));
    cleanup();
    expect(rig.ctx.addedPanels.map((p) => p.panel.id).sort()).toEqual(Object.keys(TITLES).sort());
    for (const { panel: p } of rig.ctx.addedPanels) {
      expect(p.title).toBe(TITLES[p.id]);
      expect(p.icon, `${p.id}'s icon`).toBeDefined();
      const Component = p.component;
      render(<Component />);
      expect(screen.getByRole('region', { name: p.title })).toBeDefined();
      expect(screen.queryByRole('heading', { name: p.title }), `${p.id}: no inner heading`).toBeNull();
      cleanup();
    }
  });

  it('the Event panel says its point at the top and has Save and Cancel in its foot, last', async () => {
    const rig = await activated({ symbols: true });
    feedPicture(rig.ctx, [route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1), points: [{ speed: 8.33 }, { speed: 8.33 }] }), symbol(TRACK_1, SIM_LAYER)]);
    rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha') });
    await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
    const Editor = panel(rig.ctx, 'route-editor');
    render(<Editor />);
    await screen.findByRole('region', { name: 'Point 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Add event at point 1' }));
    cleanup();
    const Event = panel(rig.ctx, 'event');
    render(<Event />);
    const region = screen.getByRole('region', { name: 'Event' });
    expect(within(region).getByText('At point 1')).toBeDefined();
    const foot = within(region).getByRole('group', { name: 'Panel actions' });
    expect(within(foot).getAllByRole('button').map((b) => b.textContent)).toEqual(['Save', 'Cancel']);
    expect(region.lastElementChild).toBe(foot);
    expect(within(region).getByRole('button', { name: 'Close the event' })).toBeDefined();
  });
});

describe('the manifest and the settings (SDK 1.8.0 part D)', () => {
  const settings = manifest.settings as unknown as SettingsSchema;

  it('has the icon Play and SDK 1.8.0', () => {
    expect(manifest.icon).toBe('Play');
    expect(Object.hasOwn(PLUGIN_ICONS, manifest.icon)).toBe(true);
    expect(pluginIcon(manifest.icon)).not.toBeNull();
    expect(manifest.sdkVersion).toBe('^1.8.0');
  });

  it('T-204: settingsHintsProblem finds nothing; every long description has a hint of at most 80 characters; the stale time in s; the colours short, side by side', () => {
    expect(settingsHintsProblem(settings)).toBeNull();
    const hints: string[] = [];
    const walk = (schema: SettingsSchema, path: string): void => {
      for (const [name, property] of Object.entries(schema.properties ?? {})) {
        const { hint } = fieldHint(property);
        if ((property.description ?? '').length > 80) expect(hint, `${path}${name}: a long description has a hint`).not.toBeNull();
        if (hint !== null) hints.push(hint);
        if (property.properties !== undefined) walk(property, `${path}${name}.`);
      }
    };
    walk(settings, '');
    expect(hints.every((h) => h.length <= 80)).toBe(true);
    const props = settings.properties ?? {};
    expect(props['outputStaleSeconds']?.['x-emc2']?.unit).toBe('s');
    for (const colour of ['jobAreaColour', 'coverageColour', 'dwellColour']) {
      const inner = props[colour]?.properties ?? {};
      expect(fieldWidth(inner['use'] ?? {}), `${colour}.use`).toBe('short');
      expect(fieldWidth(inner['colour'] ?? {}), `${colour}.colour`).toBe('short');
    }
    // The page: the stale time first, unheaded; each colour its own section under its title.
    expect(formSections(settings).map((s) => s.label)).toEqual([null, 'Job area colour', 'Coverage colour', 'Dwell colour']);
  });
});
