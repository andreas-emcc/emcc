import type { MapView } from '@emc2/plugin-sdk';
import type { ShellActions } from '../actions/actions.ts';
import type { DisplayState } from '../display/state.ts';
import type { LayerChanger } from '../layers/changer.ts';
import type { LayerCreator } from '../layers/creator.ts';
import type { KnownLayers } from '../layers/known.ts';
import type { SharedState } from '../plugins/shared.ts';
import type { Setups } from '../setups/setups.ts';
import type { MonitorApi } from './monitor/api.ts';
import type { SettingsApi } from './settings/api.ts';
import type { Drafts } from './settings/drafts.ts';
import type { LabelingSource } from './settings/labeling/LabelingEntry.tsx';

/** What the views besides View (Settings, Monitor, the plugin tabs) need besides the shell's view. */
export interface ViewServices {
  readonly api: SettingsApi;
  /** The data types and the plugins' settings, kept current by the live picture's messages. */
  readonly shared: SharedState;
  readonly drafts: Drafts;
  readonly monitor: MonitorApi;
  /** The setups and their control in the top bar; tests of other parts go without. */
  readonly setups?: Setups;
  /** The shell's actions: its menu, the shared Delete and its key; tests of other parts go without. */
  readonly actions?: ShellActions & { readonly mapView: () => Promise<MapView | null> };
  /** Settings › Layers: the layers with their counts, and the change; tests of other parts go without. */
  /** The user's display settings (SDK 1.4.0 part 5), once the configuration has arrived; tests of other parts go without. */
  readonly display?: () => DisplayState | null;
  readonly layers?: { readonly known: KnownLayers; readonly changer: LayerChanger; readonly creator?: LayerCreator };
  /** Settings › Labeling (T-170): the classifications and the label form, and the live notice; tests of other parts go without. */
  readonly labeling?: LabelingSource;
}
