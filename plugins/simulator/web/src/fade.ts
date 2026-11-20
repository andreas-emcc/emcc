// Hidden tracks are faded on the Simulation map (brief functions 13 and 22; CR-0025 part 6; A31).
// The list is the tracks marked hidden in the web part's live picture, set only while Simulation is
// shown (A56): the map view shows it in every workspace. That subscription names its workspace, so
// a workspace switch brings it no fresh snapshot: the list, which the map view clears on a switch,
// is set again from `ctx.workspace.onChange` on the way back.
import type { CurrentWorkspace, FadeList, MapView, Unsubscribe } from '@emc2/plugin-sdk';
import { SIMULATION, type SimulationPicture } from './picture.ts';

export class HiddenFade {
  private readonly list: FadeList;
  private last = '';
  private readonly cleanup: Unsubscribe[] = [];

  constructor(map: MapView, picture: SimulationPicture, workspace: CurrentWorkspace) {
    const list = map.createFadeList();
    this.list = list;
    const apply = (force: boolean) => {
      if (workspace.current.id !== SIMULATION) return;
      const ids = picture.hidden();
      const key = ids.join(',');
      if (!force && key === this.last) return;
      this.last = key;
      list.set(ids);
    };
    apply(true);
    this.cleanup.push(picture.onChange(() => {
      apply(false);
    }));
    this.cleanup.push(workspace.onChange(() => {
      apply(true);
    }));
  }

  dispose(): void {
    for (const u of this.cleanup) u();
    this.list.clear();
  }
}
