// Keeps the map view's drag armed for the selected shape (brief, function 16): `MapView.dragObject`
// waits for a press and drag on the shape and resolves with the drop. The controller says, after
// every change, which shape may be dragged now (`target`); this class starts the drag for it, ends
// it as soon as that stops holding, and arms it again after a drop.
import type { MapView, Position, Uuid } from '@emc2/plugin-sdk';

/** What the drag needs from the controller. */
export interface DragHost {
  /** The shape to arm the drag for now, or null when a condition for it does not hold (the plugin's own interactions apart: see {@link busy}). */
  target(): Uuid | null;
  /** One of the plugin's own interactions runs (a tool is on, or a reshape): the drag waits, and is armed again by its end only if {@link GraphicDrag.rearm} says so. */
  busy(): boolean;
  /** The user dropped the shape at `drop`. */
  dropped(id: Uuid, drop: Position): void;
  /** The map view refused to start the drag. */
  failed(error: unknown): void;
}

interface Run {
  readonly id: Uuid;
  readonly abort: AbortController;
}

export class GraphicDrag {
  private run: Run | null = null;
  /**
   * A drag ended with null that this class did not end: Escape, or another plugin's interaction
   * replaced it, or the map view refused it (a hidden layer). It is armed again only when something
   * of its own happens, so it never takes the map back from another plugin by itself.
   */
  private blocked = false;
  /** A condition did not hold at the last {@link sync}: when they hold again, that is something of its own. */
  private off = true;
  /** Something of its own happened while an interaction of the plugin ran: the drag is armed when that ends, whatever its result. */
  private happenedWhileBusy = false;

  constructor(
    private readonly map: MapView,
    private readonly host: DragHost,
  ) {}

  /**
   * The conditions may have changed: ends a drag that no longer fits, and arms one that does. While
   * an interaction of the plugin runs (a tool, a reshape) the drag waits, and counts as ended by
   * another plugin's interaction (blocked) unless something of its own happened meanwhile.
   */
  sync(): void {
    const id = this.host.target();
    const busy = this.host.busy();
    const run = this.run;
    if (run !== null && (run.id !== id || busy)) {
      this.run = null;
      run.abort.abort(); // the map view ends it and resolves with null; that result is ignored
    }
    if (id === null) {
      this.off = true;
      return;
    }
    if (this.off) this.happened(busy);
    this.off = false;
    if (busy) {
      this.blocked = !this.happenedWhileBusy;
      return;
    }
    this.happenedWhileBusy = false;
    if (this.run === null && !this.blocked) this.start(id);
  }

  /**
   * Something of its own happened: another selection, a layer shown again, or a tool or reshape that
   * ended with a result (or was switched off by the user). Arms the drag again if the conditions
   * hold. A tool or reshape that ended with null (Escape, or another plugin's interaction replaced
   * it) does not call this: the drag then stays off, so it never takes the map from that plugin.
   */
  rearm(): void {
    this.happened(this.host.busy());
    this.sync();
  }

  private happened(busy: boolean): void {
    this.blocked = false;
    if (busy) this.happenedWhileBusy = true;
  }

  /** Ends the drag for good (the plugin is shut down). */
  stop(): void {
    const run = this.run;
    this.run = null;
    this.blocked = true;
    run?.abort.abort();
  }

  private start(id: Uuid): void {
    const run: Run = { id, abort: new AbortController() };
    this.run = run;
    this.map.dragObject(id, { signal: run.abort.signal }).then(
      (drop) => {
        this.finished(run, drop);
      },
      (error: unknown) => {
        if (this.run !== run) return;
        this.run = null;
        this.blocked = true;
        this.host.failed(error);
      },
    );
  }

  private finished(run: Run, drop: Position | null): void {
    if (this.run !== run) return; // ended by this class, or this is the result of an old run
    this.run = null;
    if (drop === null) {
      this.blocked = true;
      return;
    }
    this.host.dropped(run.id, drop);
    this.sync(); // armed again at once while the conditions hold
  }
}
