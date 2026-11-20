// The cameras as the panel shows them (brief functions 1, 2, 8 and 11): read from GET /cameras every
// 2 s while the panel is mounted (B5), and changed through the POST commands. The state is immutable;
// React reads it with useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import type { Unsubscribe, Uuid } from '@emc2/plugin-sdk';
import type { CamerasServer } from './server.ts';

/** B5: how often the panel reads the cameras while it is mounted. */
export const READ_EVERY_MS = 2000;

export type Mode = 'trackPoint' | 'trackObject' | 'fixed' | 'sweep';
export type CameraState = 'running' | 'stopped' | 'platformGone' | 'targetGone' | 'outputMissing';

export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  trackPoint: 'Track a point',
  trackObject: 'Track an object',
  fixed: 'Fixed angles',
  sweep: 'Sweep',
};

export const STATE_LABELS: Readonly<Record<CameraState, string>> = {
  running: 'Running',
  stopped: 'Stopped',
  platformGone: 'Platform gone',
  targetGone: 'Target gone',
  outputMissing: 'Output missing',
};

export const FRAME_SIZES = ['640x360', '1280x720', '1920x1080'] as const;

/** A camera's settings, as the server writes them (brief section 5). */
export interface Settings {
  readonly mode: Mode;
  readonly point: readonly [number, number] | null;
  readonly pointHeight: number;
  readonly target: Uuid | null;
  readonly azimuth: number;
  readonly depression: number;
  readonly sectorStart: number;
  readonly sectorEnd: number;
  readonly sweepRate: number;
  readonly horizontalFov: number;
  readonly frameSize: string;
  readonly frameRate: number;
  readonly height: number;
  readonly mission: string;
  /** The output channel's id, `plugin/link`, or null for none (function 9; C1). */
  readonly output: string | null;
}

export interface CameraInfo {
  readonly id: Uuid;
  readonly platform: Uuid;
  readonly platformName: string | null;
  /** The platform's last reported `[longitude, latitude]`, or null while it is gone: Track a point's default point (section 5). */
  readonly platformPosition: readonly [number, number] | null;
  readonly targetName: string | null;
  readonly state: CameraState;
  readonly running: boolean;
  readonly settings: Settings;
  readonly poses: number;
  readonly targetGone: boolean;
  readonly output: string | null;
  /** The output's name: as offered now, else its last known name; null without an output, or when it was never seen. */
  readonly outputName: string | null;
  readonly outputMissing: boolean;
  readonly sent: number;
  /** Why the latest pose was not sent (C5, C6), or null. */
  readonly notSent: string | null;
  /** What the output link says back (function 9, part U); null without an output or while it is missing. */
  readonly outputState: LinkState | null;
  /** The link's detail for its state, e.g. "No destination"; may be empty; null as `outputState`. */
  readonly outputDetail: string | null;
}

/** An output link's state for its senders, as its plugin set it (part U, CR-0050). */
export type LinkState = 'ready' | 'degraded' | 'notSending';

/** An output on offer: a channel that takes `fmv.camera-pose` (function 9), and the camera that chose it (U10). */
export interface OutputInfo {
  readonly id: string;
  readonly name: string;
  readonly camera: Uuid | null;
  /** What the link says back (part U). */
  readonly state: LinkState;
  readonly detail: string;
}

/** A refused command: its message, and the field the server named, if any. */
export interface Failure {
  readonly message: string;
  readonly field: string | null;
}

export interface CamerasState {
  /** Null until the first answer. */
  readonly cameras: readonly CameraInfo[] | null;
  readonly outputs: readonly OutputInfo[];
  readonly readError: string | null;
  readonly failure: Failure | null;
  readonly busy: boolean;
  /** The camera whose form is open. */
  readonly open: Uuid | null;
  /** The map's selection, for "Use selection". */
  readonly selection: readonly Uuid[];
}

/** The name a camera is listed by: its platform's (brief function 11). */
export function cameraName(c: CameraInfo): string {
  return c.platformName ?? '(no name)';
}

export class CamerasModel {
  private readonly listeners = new Set<() => void>();
  private current: CamerasState = { cameras: null, outputs: [], readError: null, failure: null, busy: false, open: null, selection: [] };
  private watchers = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading = false;

  constructor(private readonly server: CamerasServer) {}

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): CamerasState => this.current;

  private update(patch: Partial<CamerasState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** For the panel's effect: reads at once and every 2 s while mounted; returns its cleanup. */
  readonly watch = (): (() => void) => {
    if (this.watchers++ === 0) {
      void this.read();
      this.timer = setInterval(() => void this.read(), READ_EVERY_MS);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.watchers === 0 && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  };

  async read(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      const answer = await this.server.get('cameras');
      if (!answer.ok) {
        this.update({ readError: answer.message });
        return;
      }
      this.update({ cameras: camerasOf(answer.body), outputs: outputsOf(answer.body), readError: null });
    } finally {
      this.reading = false;
    }
  }

  setSelection(ids: readonly Uuid[]): void {
    this.update({ selection: ids });
  }

  openCamera(id: Uuid | null): void {
    this.update({ open: id, failure: null });
  }

  dismissFailure(): void {
    this.update({ failure: null });
  }

  /** "New camera" on `platform`: a new camera, or the one already on it (U2), opened in the form. */
  async newCamera(platform: Uuid): Promise<boolean> {
    const answer = await this.command('cameras', { platform }, true);
    if (answer.ok) {
      const made = cameraOf(answer.body);
      if (made !== null) this.update({ open: made.id });
      return true;
    }
    if (answer.camera !== null) {
      this.update({ open: answer.camera, failure: null });
      return true;
    }
    return false;
  }

  /** Saves `patch` (settings, or `platform`) to camera `id`. */
  async save(id: Uuid, patch: Readonly<Record<string, unknown>>): Promise<boolean> {
    return (await this.command(`cameras/${id}`, patch)).ok;
  }

  async remove(id: Uuid): Promise<boolean> {
    const ok = (await this.command(`cameras/${id}/remove`, {})).ok;
    if (ok && this.current.open === id) this.update({ open: null });
    return ok;
  }

  async start(id: Uuid): Promise<boolean> {
    return (await this.command(`cameras/${id}/start`, {})).ok;
  }

  async stop(id: Uuid): Promise<boolean> {
    return (await this.command(`cameras/${id}/stop`, {})).ok;
  }

  /** `opensCamera`: "New camera", whose 409 names the track's camera, which is opened instead (U2). */
  private async command(path: string, body: unknown, opensCamera = false) {
    this.update({ busy: true, failure: null });
    const answer = await this.server.post(path, body);
    const opens = !answer.ok && opensCamera && answer.camera !== null;
    this.update({ busy: false, failure: answer.ok || opens ? null : { message: answer.message, field: answer.field } });
    await this.read();
    return answer;
  }
}

export function useCameras(model: CamerasModel): CamerasState {
  return useSyncExternalStore(model.subscribe, model.getState);
}

function outputsOf(body: unknown): readonly OutputInfo[] {
  if (typeof body !== 'object' || body === null) return [];
  const list = (body as { readonly outputs?: unknown }).outputs;
  return Array.isArray(list) ? list.filter((o): o is OutputInfo => typeof o === 'object' && o !== null && typeof (o as { readonly id?: unknown }).id === 'string') : [];
}

/** The mark after a link's name for its state (part U): none while it is ready. */
export function linkMark(state: LinkState | null): string {
  return state === 'notSending' ? ' (not sending)' : state === 'degraded' ? ' (degraded)' : '';
}

/** How a camera's output is shown: "No output" (C3), its name with what it says back, or its last known name marked missing (C4). */
export function outputLabel(c: CameraInfo): string {
  if (c.output === null) return 'No output';
  const name = c.outputName ?? c.output;
  return c.outputMissing ? `${name} (missing)` : `${name}${linkMark(c.outputState)}`;
}

/** What the camera's output link says back, for the form's notice; null while it is ready, or without an output. */
export function linkNotice(c: CameraInfo): string | null {
  const detail = c.outputDetail === null || c.outputDetail === '' ? '' : `: ${c.outputDetail}`;
  if (c.outputState === 'notSending') return `The output sends nothing${detail}`;
  if (c.outputState === 'degraded') return `The output is degraded${detail}`;
  return null;
}

function camerasOf(body: unknown): readonly CameraInfo[] {
  if (typeof body !== 'object' || body === null) return [];
  const list = (body as { readonly cameras?: unknown }).cameras;
  return Array.isArray(list) ? list.map(cameraOf).filter((c): c is CameraInfo => c !== null) : [];
}

/** The server's camera JSON; it is the plugin's own server part, so its shape is trusted once it is an object with an id. */
function cameraOf(value: unknown): CameraInfo | null {
  if (typeof value !== 'object' || value === null || typeof (value as { readonly id?: unknown }).id !== 'string') return null;
  return value as CameraInfo;
}
