import { useLayoutEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw } from 'lucide-react';
import { Button, IconButton, List, ListRow, Notice, Select } from '@emc2/plugin-sdk';
import type { MapObject } from '@emc2/plugin-sdk';
import type { ListState, ObjectListController } from './controller.ts';
import { cellsOf, countText, lastPageIndex, rangeText, tooltipOf } from './format.ts';
import { RowImage } from './RowImage.tsx';

/** Shown in the layer chooser until the user (or `open`) picks a layer. */
const NO_LAYER = '';

/**
 * The panel "Objects": the layer chooser, the pages of the shown layer and the messages. The shell
 * draws the panel's head and padding, so there is no frame of our own. It works in every pane
 * (ADR-0031 point 4): the controls wrap, the list scrolls under them, nothing has a fixed width.
 */
export function ObjectsPanel(props: { readonly controller: ObjectListController }) {
  const { controller } = props;
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const { page, pageSize } = state;
  const options = [{ value: NO_LAYER, label: 'Choose a layer', disabled: state.layerId !== null }, ...state.layers.map((l) => ({ value: l.id, label: l.name }))];
  const hasRows = state.layerId !== null && page.read && page.total > 0;
  const last = lastPageIndex(page.total, pageSize);

  // The controls stay in view above the rows, so a row the keyboard moves to must scroll clear of
  // them, not under them: the rows' scroll margin is the controls' height (see the stylesheet).
  const section = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = section.current;
    const controls = panel?.querySelector('.object-list-controls') ?? null;
    if (panel === null || controls === null) return undefined;
    const measure = () => {
      panel.style.setProperty('--object-list-controls-height', `${String(controls.getBoundingClientRect().height)}px`);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <section ref={section} className="object-list" aria-label="Objects">
      <div className="object-list-controls">
        <div className="object-list-toolbar">
          <div className="object-list-chooser">
            <Select
              label="Layer"
              value={state.layer?.id ?? NO_LAYER}
              options={options}
              disabled={!state.loaded || state.layers.length === 0}
              onChange={(value) => {
                controller.choose(value === NO_LAYER ? null : value);
              }}
            />
          </div>
          {state.layer !== null && <span className="object-list-count">{countText(state.total)}</span>}
          {hasRows && (
            <>
              <span className="object-list-range" role="status">
                {rangeText(page.index, pageSize, page.objects.length, page.total)}
              </span>
              <span className="object-list-pager-buttons">
                <IconButton icon={ChevronsLeft} label="First page" disabled={page.index === 0} onClick={() => { controller.first(); }} />
                <IconButton icon={ChevronLeft} label="Previous page" disabled={page.index === 0} onClick={() => { controller.previous(); }} />
                <IconButton icon={ChevronRight} label="Next page" disabled={page.index >= last} onClick={() => { controller.next(); }} />
                <IconButton icon={ChevronsRight} label="Last page" disabled={page.index >= last} onClick={() => { controller.last(); }} />
              </span>
            </>
          )}
          <IconButton icon={RefreshCw} label="Refresh" disabled={state.layerId === null || page.loading} onClick={() => { controller.refresh(); }} />
        </div>
        {hasRows && (
          <div className="object-list-head" aria-hidden="true">
            <span className="object-list-cell-image" />
            <span className="object-list-cell-name">Name</span>
            <span className="object-list-cell-kind">Kind</span>
            <span className="object-list-cell-extra">Data type</span>
            <span className="object-list-cell-extra">Source</span>
            <span className="object-list-cell-extra">Classification</span>
            <span className="object-list-cell-extra">Modified</span>
          </div>
        )}
      </div>
      {state.closedNotice !== null && <Notice>{state.closedNotice}</Notice>}
      {state.layer === null && state.closedNotice === null && (
        <p className="object-list-hint">{state.loaded && state.layers.length === 0 ? 'There are no layers' : 'Choose a layer to list its objects'}</p>
      )}
      {state.mapView === 'failed' && <Notice severity="warning">No map view is loaded: objects cannot be selected</Notice>}
      {page.error !== null && (
        <div className="object-list-failure">
          <Notice severity="error">{`The objects could not be read: ${page.error}`}</Notice>
          <Button icon={RefreshCw} onClick={() => { controller.refresh(); }}>
            Retry
          </Button>
        </div>
      )}
      {state.layerId !== null && !page.read && page.error === null && (
        <p className="object-list-hint" role="status">
          Loading…
        </p>
      )}
      {state.layerId !== null && page.read && page.total === 0 && <p className="object-list-hint">No objects in this layer</p>}
      {hasRows && <Rows controller={controller} state={state} />}
    </section>
  );
}

/**
 * The rows, and the keyboard (acceptance criterion 10). The shared `List` is one Tab stop and moves
 * the focus with the arrow keys, Home and End (CR-0019); it does not select. `ListRow` does the
 * rest of what a row needs: Space selects it (with Ctrl or Cmd it adds or removes it, and the page
 * does not scroll) and Enter zooms the map to the object (its activate). This panel adds only the
 * menu key or Shift+F10, which opens the object action menu at the row with the same rules as a
 * right click.
 */
function Rows(props: { readonly controller: ObjectListController; readonly state: ListState }) {
  const { controller, state } = props;
  const { page } = state;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('li[role="option"]') : null;
    if (row === null) return;
    switch (event.key) {
      case 'ContextMenu':
      case 'F10': {
        if (event.key === 'F10' && !event.shiftKey) break;
        const rows = [...(row.parentElement?.querySelectorAll('li[role="option"]') ?? [])];
        const object = page.objects[rows.indexOf(row)];
        if (object === undefined) break;
        event.preventDefault();
        const at = row.getBoundingClientRect();
        controller.openMenu(object.id, [at.left + at.width / 4, at.bottom]);
        break;
      }
      default:
        break;
    }
  };

  return (
    // The wrapper only listens: the keys bubble up from the rows, which are the focusable elements.
    <div className="object-list-rows" role="presentation" onKeyDown={onKeyDown}>
      <List label="Objects of the layer" multiselect>
        {page.objects.map((object) => (
          <Row key={object.id} object={object} controller={controller} state={state} />
        ))}
      </List>
    </div>
  );
}

/**
 * One row. Click selects, Ctrl or Cmd+click adds or removes, a double-click zooms the map to the
 * object, a right click opens the shell's object action menu (brief, functions 5 and 6). The full
 * set of cells is always in the row's tooltip; a narrow pane shows only the image, the name and the
 * kind (function 4).
 */
function Row(props: { readonly object: MapObject; readonly controller: ObjectListController; readonly state: ListState }) {
  const { object, controller, state } = props;
  const cells = cellsOf(object, (id) => controller.dataTypeName(id));
  return (
    <ListRow
      selected={state.selected.has(object.id)}
      onSelect={(additive) => {
        controller.select(object.id, additive);
      }}
      onActivate={() => {
        controller.zoomTo(object.id);
      }}
      onMenu={(at) => {
        controller.openMenu(object.id, at);
      }}
    >
      <div className="object-list-row" title={tooltipOf(cells)}>
        <span className="object-list-cell-image">
          {state.symbols !== null && object.symbol !== undefined && <RowImage symbols={state.symbols} symbol={object.symbol} size={state.imageSize} />}
        </span>
        <span className="object-list-cell-name">{cells.name}</span>
        <span className="object-list-cell-kind">{cells.kind}</span>
        <span className="object-list-cell-extra">{cells.dataType}</span>
        <span className="object-list-cell-extra">{cells.dataSource}</span>
        <span className="object-list-cell-extra">{cells.classification}</span>
        <span className="object-list-cell-extra object-list-data">{cells.modified}</span>
      </div>
    </ListRow>
  );
}
