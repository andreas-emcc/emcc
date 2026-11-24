// The web part (brief functions 9, 11 and 12; criteria 1, 14 and 15): the manifest, the Cameras panel in
// Simulation, its list and form with the Output, the server's messages at the field, and the object
// action New camera.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAP_VIEW } from '@emc2/plugin-sdk';
import { checkLookCss, createFakeContext, createFakeMapView, createFakeUser } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin, { EDIT, RUN, SIMULATION, VIEW } from '../src/index.tsx';
import type { CameraInfo, OutputInfo, Settings } from '../src/cameras.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const PLATFORM = '0193a1f2-7c4e-7d10-9a3b-2f6e8c1d4b57';
const OTHER = '0193a1f2-7c4e-7d10-9a3b-2f6e8c1d4b58';

const SETTINGS: Settings = {
  mode: 'fixed', point: null, pointHeight: 0, target: null, azimuth: 0, depression: 30, sectorStart: 315, sectorEnd: 45, sweepRate: 10,
  horizontalFov: 20, frameSize: '1280x720', frameRate: 25, height: 1000, mission: '', output: null,
  sway: false, swayAmplitude: 0.3, swayMinFrequency: 0.5, swayMaxFrequency: 3, swayJoltsPerMinute: 2, swayJoltStrength: 0.5, swayJoltDecay: 0.5,
  swaySeed: 1,
  overlay: false,
};

function camera(id: string, patch: Partial<CameraInfo> = {}): CameraInfo {
  return {
    id, platform: PLATFORM, platformName: 'Hawk 1', platformPosition: [17.3, 62.4], targetName: null, state: 'stopped', running: false, settings: SETTINGS, poses: 0,
    targetGone: false, output: null, outputName: null, outputMissing: false, sent: 0, notSent: null,
    outputState: null, outputDetail: null, ...patch,
  };
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** The plugin's server part, scripted: GET /cameras gives `cameras` and `outputs`; each POST answers from `posts` by path, else 200 with the camera. */
function fakeServer(
  base: string,
  cameras: CameraInfo[],
  posts: Readonly<Record<string, { readonly status: number; readonly body: unknown }>> = {},
  outputs: OutputInfo[] = [],
) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = url.slice(base.length);
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, path, body });
    const answer = method === 'GET' ? { status: 200, body: { cameras, outputs, max: 50 } } : (posts[path] ?? { status: 200, body: cameras[0] ?? {} });
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } }));
  }));
  return calls;
}

async function activated(permissions: readonly string[] = [VIEW, EDIT, RUN]) {
  const ctx = createFakeContext({ pluginId: manifest.id, user: createFakeUser({ permissions }) });
  const map = createFakeMapView({ pluginId: manifest.id });
  ctx.provideAs(MAP_VIEW, map);
  await plugin.activate(ctx);
  return { ctx, map };
}

async function shown(permissions?: readonly string[]) {
  const rig = await activated(permissions);
  const Panel = rig.ctx.addedPanels[0]?.panel.component;
  if (Panel === undefined) throw new Error('no panel');
  render(<Panel />);
  await screen.findByRole('list', { name: 'Cameras' });
  return rig;
}

async function openForm(name = 'Hawk 1') {
  fireEvent.click(within(screen.getByRole('listitem', { name })).getAllByRole('button')[0] as HTMLElement);
  return screen.findByRole('form', { name: `Camera on ${name}` });
}

describe('the manifest and the package (criterion 1)', () => {
  it('names the plugin, its three permissions, its CSS, and nothing of a link', () => {
    expect(manifest.id).toBe('uav-simulation');
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
    expect(manifest.permissions).toEqual([VIEW, EDIT, RUN]);
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
    for (const key of ['connections', 'internet', 'compute', 'dataTypes', 'channels', 'channelKinds', 'settings']) {
      expect(Object.keys(manifest)).not.toContain(key);
    }
  });

  it('keeps its CSS to the shell tokens and its own classes', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/uav-simulation.css'), 'utf8');
    expect(checkLookCss(css, { pluginId: manifest.id })).toEqual([]);
  });
});

describe('the panel and the action (criteria 14 and 15)', () => {
  it('adds the Cameras panel and New camera in Simulation only, New camera for edit', async () => {
    fakeServer('', []);
    const { ctx } = await activated();
    expect(ctx.addedPanels.map((p) => [p.panel.id, p.panel.defaultPane, p.panel.workspaces])).toEqual([['cameras', 'right', [SIMULATION]]]);
    const action = ctx.objectActions.find((a) => a.id === 'new-camera');
    expect(action?.workspaces).toEqual([SIMULATION]);
    expect(action?.permission).toBe(EDIT);
    expect(action?.multiple).toBe(false);
    expect(action?.appliesTo.types).toEqual(['core.symbol']);
  });

  it('adds nothing without view', async () => {
    const { ctx } = await activated([EDIT, RUN]);
    expect(ctx.addedPanels).toEqual([]);
    expect(ctx.objectActions).toEqual([]);
  });

  it('lists each camera by its platform with its state and mode, Start for run', async () => {
    const { ctx } = await activated();
    fakeServer(ctx.serverBase, [camera('c1'), camera('c2', { platformName: null, state: 'running', running: true, settings: { ...SETTINGS, mode: 'sweep' } })]);
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (Panel === undefined) throw new Error('no panel');
    render(<Panel />);
    const first = await screen.findByRole('listitem', { name: 'Hawk 1' });
    expect(first.textContent).toContain('Stopped');
    expect(first.textContent).toContain('Fixed angles');
    expect(within(first).getByRole('button', { name: 'Start' })).toBeDefined();
    const second = screen.getByRole('listitem', { name: '(no name)' });
    expect(second.textContent).toContain('Running');
    expect(second.textContent).toContain('Sweep');
    expect(within(second).getByRole('button', { name: 'Stop' })).toBeDefined();
  });

  it('offers no Start while the platform is gone', async () => {
    const { ctx } = await activated();
    fakeServer(ctx.serverBase, [camera('c1', { state: 'platformGone' })]);
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (Panel === undefined) throw new Error('no panel');
    render(<Panel />);
    const row = await screen.findByRole('listitem', { name: 'Hawk 1' });
    expect(row.textContent).toContain('Platform gone');
    expect(within(row).getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true);
  });

  it('shows no Start without run, and a read-only form without edit', async () => {
    const { ctx } = await activated([VIEW]);
    fakeServer(ctx.serverBase, [camera('c1')]);
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (Panel === undefined) throw new Error('no panel');
    render(<Panel />);
    const row = await screen.findByRole('listitem', { name: 'Hawk 1' });
    expect(within(row).queryByRole('button', { name: 'Start' })).toBeNull();
    const form = await openForm();
    expect(within(form).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(form).getByLabelText<HTMLInputElement>('Azimuth (°)').readOnly).toBe(true);
    expect(screen.getByText('You may look at the cameras, not change them')).toBeDefined();
  });

  it("shows only the chosen mode's fields", async () => {
    fakeServer(createFakeContext({ pluginId: manifest.id }).serverBase, [camera('c1')]);
    await shown();
    const form = await openForm();
    expect(within(form).queryByLabelText('Azimuth (°)')).not.toBeNull();
    expect(within(form).queryByLabelText('Sector start (°)')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Pointing mode'), { target: { value: 'sweep' } });
    expect(within(form).queryByLabelText('Azimuth (°)')).toBeNull();
    expect(within(form).queryByLabelText('Sector start (°)')).not.toBeNull();
    expect(within(form).queryByLabelText('Sweep rate (°/s)')).not.toBeNull();
    fireEvent.change(within(form).getByLabelText('Pointing mode'), { target: { value: 'trackPoint' } });
    expect(within(form).queryByLabelText('Longitude (°)')).not.toBeNull();
    expect(within(form).queryByLabelText('Depression (°)')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Pointing mode'), { target: { value: 'trackObject' } });
    expect(within(form).getByRole('button', { name: 'Use selection' })).toBeDefined();
  });

  it("fills Track a point's point with the platform's position when the mode is chosen (section 5)", async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const calls = fakeServer(base, [camera('c1')], { 'cameras/c1': { status: 200, body: camera('c1') } });
    await shown();
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('Pointing mode'), { target: { value: 'trackPoint' } });
    // Longitude first, latitude ≠ longitude (ADR-0007).
    expect(within(form).getByLabelText<HTMLInputElement>('Longitude (°)').value).toBe('17.3');
    expect(within(form).getByLabelText<HTMLInputElement>('Latitude (°)').value).toBe('62.4');
    // A point the user typed stays when the mode changes and comes back.
    fireEvent.change(within(form).getByLabelText('Longitude (°)'), { target: { value: '17.31' } });
    fireEvent.change(within(form).getByLabelText('Pointing mode'), { target: { value: 'fixed' } });
    fireEvent.change(within(form).getByLabelText('Pointing mode'), { target: { value: 'trackPoint' } });
    expect(within(form).getByLabelText<HTMLInputElement>('Longitude (°)').value).toBe('17.31');
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ mode: 'trackPoint', point: [17.31, 62.4] }); });
  });

  it('leaves the point empty when the platform is gone', async () => {
    fakeServer(createFakeContext({ pluginId: manifest.id }).serverBase, [camera('c1', { platformPosition: null, state: 'platformGone' })]);
    await shown();
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('Pointing mode'), { target: { value: 'trackPoint' } });
    expect(within(form).getByLabelText<HTMLInputElement>('Longitude (°)').value).toBe('');
  });

  it("shows the server's message at the field for a value outside the limits", async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const calls = fakeServer(base, [camera('c1')], { 'cameras/c1': { status: 400, body: { error: '0.1° to 120°', field: 'horizontalFov' } } });
    await shown();
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('Horizontal field of view (°)'), { target: { value: '130' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('0.1° to 120°')).toBeDefined();
    const save = calls.find((c) => c.method === 'POST');
    expect(save?.path).toBe('cameras/c1');
    expect(save?.body).toMatchObject({ mode: 'fixed', horizontalFov: 130, azimuth: 0, depression: 30, frameSize: '1280x720' });
    expect(save?.body).not.toHaveProperty('sectorStart');
    // A new value clears the server's message, which was for the old one.
    fireEvent.change(within(form).getByLabelText('Horizontal field of view (°)'), { target: { value: '40' } });
    expect(within(form).queryByText('0.1° to 120°')).toBeNull();
  });

  it("criterion 26: shows the micro sway's fields only while it is on, and saves them with it", async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const calls = fakeServer(base, [camera('c1')]);
    await shown();
    const form = await openForm();
    const box = within(form).getByLabelText<HTMLInputElement>('Micro sway');
    expect(box.checked).toBe(false);
    expect(within(form).queryByLabelText('Sway amplitude (°)')).toBeNull();
    fireEvent.click(box);
    expect(within(form).getByLabelText<HTMLInputElement>('Sway amplitude (°)').value).toBe('0.3');
    for (const label of ['Sway lowest frequency (Hz)', 'Sway highest frequency (Hz)', 'Jolts a minute', 'Jolt strength (°)', 'Jolt decay (s)', 'Sway seed']) {
      expect(within(form).getByLabelText(label)).toBeDefined();
    }
    fireEvent.change(within(form).getByLabelText('Sway amplitude (°)'), { target: { value: '0,8' } });
    fireEvent.change(within(form).getByLabelText('Sway seed'), { target: { value: '42' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        sway: true, swayAmplitude: 0.8, swayMinFrequency: 0.5, swayMaxFrequency: 3, swayJoltsPerMinute: 2, swayJoltStrength: 0.5, swayJoltDecay: 0.5, swaySeed: 42,
      });
    });
  });

  it('saves the sway off without its values, which the server keeps', async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const calls = fakeServer(base, [camera('c1', { settings: { ...SETTINGS, sway: true, swayAmplitude: 1.2 } })]);
    await shown();
    const form = await openForm();
    expect(within(form).getByLabelText<HTMLInputElement>('Sway amplitude (°)').value).toBe('1.2');
    fireEvent.click(within(form).getByLabelText('Micro sway'));
    expect(within(form).queryByLabelText('Sway amplitude (°)')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ sway: false }); });
    expect(calls.find((c) => c.method === 'POST')?.body).not.toHaveProperty('swayAmplitude');
  });

  it('criterion 26: shows the sway read only without edit', async () => {
    fakeServer(createFakeContext({ pluginId: manifest.id }).serverBase, [camera('c1', { settings: { ...SETTINGS, sway: true } })]);
    await shown([VIEW, RUN]);
    const form = await openForm();
    expect(within(form).getByLabelText<HTMLInputElement>('Micro sway').disabled).toBe(true);
    expect(within(form).getByLabelText<HTMLInputElement>('Jolt decay (s)').readOnly).toBe(true);
  });

  it("criterion 22 (CR-0055): the overlay's checkbox is off for a new camera and saves the setting", async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const calls = fakeServer(base, [camera('c1')]);
    await shown();
    const form = await openForm();
    const box = within(form).getByLabelText<HTMLInputElement>("Burn the camera's data into the video");
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ overlay: true }); });
  });

  it("criterion 22 (CR-0055): switched off, the overlay saves false; read only without edit", async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const calls = fakeServer(base, [camera('c1', { settings: { ...SETTINGS, overlay: true } })]);
    await shown();
    const form = await openForm();
    const box = within(form).getByLabelText<HTMLInputElement>("Burn the camera's data into the video");
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ overlay: false }); });
    cleanup();
    fakeServer(createFakeContext({ pluginId: manifest.id }).serverBase, [camera('c1', { settings: { ...SETTINGS, overlay: true } })]);
    await shown([VIEW, RUN]);
    const readOnly = within(await openForm()).getByLabelText<HTMLInputElement>("Burn the camera's data into the video");
    expect(readOnly.checked).toBe(true);
    expect(readOnly.disabled).toBe(true);
  });

  it('asks before Remove, naming the camera', async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const calls = fakeServer(base, [camera('c1')], { 'cameras/c1/remove': { status: 200, body: { cameras: [] } } });
    await shown();
    const form = await openForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/Remove the camera on Hawk 1\?/)).toBeDefined();
    expect(calls.some((c) => c.path === 'cameras/c1/remove')).toBe(false);
    const removes = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removes[removes.length - 1] as HTMLElement);
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === 'cameras/c1/remove')).toBe(true);
    });
  });

  it('New camera makes a camera on the track, shows the panel and opens its form', async () => {
    const { ctx } = await activated();
    const calls = fakeServer(ctx.serverBase, [camera('c1')]);
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (Panel === undefined) throw new Error('no panel');
    render(<Panel />);
    await screen.findByRole('list', { name: 'Cameras' });
    await act(async () => {
      void ctx.objectActions.find((a) => a.id === 'new-camera')?.run([PLATFORM]);
      await Promise.resolve();
    });
    expect(ctx.addedPanels[0]?.shown).toBe(1);
    await screen.findByRole('form', { name: 'Camera on Hawk 1' });
    expect(calls.find((c) => c.method === 'POST')).toEqual({ method: 'POST', path: 'cameras', body: { platform: PLATFORM } });
  });

  it("New camera on a track that has one opens that one (U2); a refused one tells why", async () => {
    const { ctx } = await activated();
    fakeServer(ctx.serverBase, [camera('c1')], { cameras: { status: 409, body: { error: 'the track already has a camera', field: 'platform', camera: 'c1' } } });
    const Panel = ctx.addedPanels[0]?.panel.component;
    if (Panel === undefined) throw new Error('no panel');
    render(<Panel />);
    await screen.findByRole('list', { name: 'Cameras' });
    await act(async () => {
      void ctx.objectActions.find((a) => a.id === 'new-camera')?.run([PLATFORM]);
      await Promise.resolve();
    });
    await screen.findByRole('form', { name: 'Camera on Hawk 1' });
    expect(ctx.notifications).toEqual([]);
    cleanup();
    vi.unstubAllGlobals();
    fakeServer(ctx.serverBase, [], { cameras: { status: 404, body: { error: 'not a symbol in the Simulation workspace', field: 'platform' } } });
    await act(async () => {
      void ctx.objectActions.find((a) => a.id === 'new-camera')?.run([OTHER]);
      await new Promise((r) => setTimeout(r, 0));
    });
    await vi.waitFor(() => {
      expect(ctx.notifications.at(-1)).toEqual({ severity: 'warning', message: 'not a symbol in the Simulation workspace' });
    });
  });
});

describe('the output (function 9; C1 to C6)', () => {
  const NORTH: OutputInfo = { id: 'fmv/out-a', name: 'UAV North (out)', camera: null, state: 'ready', detail: '' };
  const SOUTH: OutputInfo = { id: 'fmv/out-b', name: 'UAV South (out)', camera: 'c2', state: 'ready', detail: '' };

  it('offers None and the outputs on offer, one another camera chose as taken, and saves the choice', async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const calls = fakeServer(base, [camera('c1'), camera('c2', { platformName: 'Hawk 2', output: 'fmv/out-b', outputName: 'UAV South (out)', settings: { ...SETTINGS, output: 'fmv/out-b' } })], {}, [NORTH, SOUTH]);
    await shown();
    expect(screen.getByRole('listitem', { name: 'Hawk 1' }).textContent).toContain('No output');
    expect(screen.getByRole('listitem', { name: 'Hawk 2' }).textContent).toContain('UAV South (out)');
    const form = await openForm();
    const select = within(form).getByLabelText<HTMLSelectElement>('Output');
    expect([...select.options].map((o) => [o.value, o.text, o.disabled])).toEqual([
      ['', 'None', false],
      ['fmv/out-a', 'UAV North (out)', false],
      ['fmv/out-b', 'UAV South (out) (used by Hawk 2)', true],
    ]);
    fireEvent.change(select, { target: { value: 'fmv/out-a' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ output: 'fmv/out-a' });
    });
  });

  it('keeps a missing output, shown as missing, and saves it unchanged', async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const missing = camera('c1', { state: 'outputMissing', running: true, output: 'fmv/out-a', outputName: 'UAV North (out)', outputMissing: true, settings: { ...SETTINGS, output: 'fmv/out-a' } });
    const calls = fakeServer(base, [missing]);
    await shown();
    const row = screen.getByRole('listitem', { name: 'Hawk 1' });
    expect(row.textContent).toContain('Output missing');
    expect(row.textContent).toContain('UAV North (out) (missing)');
    const form = await openForm();
    const select = within(form).getByLabelText<HTMLSelectElement>('Output');
    expect(select.value).toBe('fmv/out-a');
    expect(select.selectedOptions[0]?.text).toBe('UAV North (out) (missing)');
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ output: 'fmv/out-a' });
    });
  });

  it("shows the server's refusal at the Output, though it names the other camera (U10)", async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    fakeServer(base, [camera('c1')], { 'cameras/c1': { status: 409, body: { error: 'the output is used by another camera', field: 'output', camera: 'c2' } } }, [NORTH]);
    await shown();
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('Output'), { target: { value: 'fmv/out-a' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByText('the output is used by another camera')).toBeDefined();
    fireEvent.change(within(form).getByLabelText('Output'), { target: { value: '' } });
    expect(within(form).queryByText('the output is used by another camera')).toBeNull();
  });

  it('says why a pose was not sent, and that no output takes poses', async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const reason = "the platform's height, 25000 m, is outside −1 000 to 20 000 m";
    fakeServer(base, [camera('c1', { state: 'running', running: true, notSent: reason, sent: 3, poses: 7 })]);
    await shown();
    const form = await openForm();
    expect(within(form).getByText(`Not sent: ${reason}`)).toBeDefined();
    expect(form.textContent).toContain('7 poses · 3 sent');
    expect(within(form).getByText('No output takes camera poses. An admin adds an output link to fmv.')).toBeDefined();
  });
});

describe('what the link says back (function 9, part U)', () => {
  const OUT = { output: 'fmv/out-a', outputName: 'UAV North (out)', settings: { ...SETTINGS, output: 'fmv/out-a' } };

  it("shows a link that sends nothing in the row, the form and the Output select, with fmv's detail", async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    const idle: OutputInfo = { id: 'fmv/out-a', name: 'UAV North (out)', camera: 'c1', state: 'notSending', detail: 'No destination' };
    const late: OutputInfo = { id: 'fmv/out-b', name: 'UAV South (out)', camera: null, state: 'degraded', detail: 'Frames late' };
    fakeServer(base, [camera('c1', { ...OUT, state: 'running', running: true, outputState: 'notSending', outputDetail: 'No destination' })], {}, [idle, late]);
    await shown();
    const row = screen.getByRole('listitem', { name: 'Hawk 1' });
    expect(row.textContent).toContain('Running');
    expect(row.textContent).toContain('UAV North (out) (not sending)');
    const form = await openForm();
    expect(within(form).getByText('The output sends nothing: No destination')).toBeDefined();
    const select = within(form).getByLabelText<HTMLSelectElement>('Output');
    expect([...select.options].map((o) => o.text)).toEqual(['None', 'UAV North (out) (not sending)', 'UAV South (out) (degraded)']);
    fireEvent.change(select, { target: { value: 'fmv/out-b' } });
    expect(within(form).queryByText('The output sends nothing: No destination')).toBeNull();
  });

  it('shows a degraded link, and nothing while the link is ready', async () => {
    const base = createFakeContext({ pluginId: manifest.id }).serverBase;
    fakeServer(base, [
      camera('c1', { ...OUT, outputState: 'degraded', outputDetail: 'Frames late' }),
      camera('c2', { ...OUT, platformName: 'Hawk 2', outputState: 'ready', outputDetail: '' }),
    ]);
    await shown();
    expect(screen.getByRole('listitem', { name: 'Hawk 1' }).textContent).toContain('UAV North (out) (degraded)');
    expect(screen.getByRole('listitem', { name: 'Hawk 2' }).textContent).toContain('UAV North (out)');
    expect(screen.getByRole('listitem', { name: 'Hawk 2' }).textContent).not.toContain('(degraded)');
    const form = await openForm();
    expect(within(form).getByText('The output is degraded: Frames late')).toBeDefined();
    const other = await openForm('Hawk 2');
    expect(other.textContent).not.toContain('The output');
  });
});
