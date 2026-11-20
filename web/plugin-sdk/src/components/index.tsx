/**
 * The shared components (ADR-0029 point 2, ADR-0034, CR-0015 items 20 and 21). They use only the
 * design tokens; their CSS (`@emc2/plugin-sdk/components.css`) ships with the shell, apart from any
 * plugin's own CSS. All are controlled: the plugin keeps the state and passes it in. Class names
 * start with `emc2-`, which plugins never use for their own classes.
 *
 * @example
 * <PanelFrame title="Bookmarks" actions={<IconButton icon={Plus} label="Add bookmark" onClick={add} />}>
 *   <List label="Bookmarks">{rows}</List>
 * </PanelFrame>
 */
import { useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { IconComponent } from '../workspace.ts';
import { isNavigationKey, itemsOf, nextItem, useRovingTabIndex } from './keys.ts';
import { placePopover } from './overlay.ts';
import { dropTarget, type DropPlace } from './tree.ts';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

/** The items the arrow keys move between (CR-0019). */
const MENU_ITEM = '.emc2-menu-item';
const LIST_ROW = '[role="option"]';
const TREE_ITEM = '.emc2-tree-item';

/**
 * A Lucide icon in the current text colour, at the density's icon size, with an absolute stroke of
 * 1.75 px in every size (looks.md, Icons). Without `label` it is decorative (`aria-hidden`).
 *
 * @example
 * import { Layers } from 'lucide-react';
 * <Icon icon={Layers} />
 */
export function Icon(props: { readonly icon: IconComponent; readonly label?: string }): ReactNode {
  const Svg = props.icon;
  return props.label === undefined
    ? <Svg className="emc2-icon" aria-hidden="true" focusable="false" />
    : <Svg className="emc2-icon" role="img" aria-label={props.label} focusable="false" />;
}

/**
 * A panel's frame and header (ADR-0029 point 2): the title in the look's heading style, optional actions on the right, then the content.
 *
 * SDK 1.8.0 part G (CR-0043; owner XD A, 2026-11-15):
 * - `heading={false}` draws no heading, for a panel the shell already names ("name once", part C);
 *   the title stays the panel's accessible name, and the actions, if any, keep their bar.
 * - `foot` (a {@link PanelFoot}) is drawn after the scrolling body: full width, and pinned to the
 *   panel's bottom edge while the body scrolls, also in the shell's panel.
 *
 * @example
 * <PanelFrame title="Graphics" heading={false} foot={<PanelFoot><Button variant="primary" onClick={place}>Place</Button></PanelFoot>}>
 *   <TileGrid label="Graphics" selected={id} onSelect={setId} groups={groups} />
 * </PanelFrame>
 */
export function PanelFrame(props: {
  readonly title: string;
  readonly heading?: boolean;
  readonly actions?: ReactNode;
  readonly foot?: ReactNode;
  readonly children?: ReactNode;
}): ReactNode {
  const heading = props.heading !== false;
  const actions = props.actions === undefined ? null : <div className="emc2-panel-actions">{props.actions}</div>;
  return (
    <section className="emc2-panel" aria-label={props.title}>
      {heading || actions !== null ? (
        <header className="emc2-panel-head">
          {heading ? <h2 className="emc2-panel-title">{props.title}</h2> : null}
          {actions}
        </header>
      ) : null}
      <div className="emc2-panel-body">{props.children}</div>
      {props.foot === undefined ? null : props.foot}
    </section>
  );
}

export interface ButtonProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  /** `primary` in the accent colour, `danger` for deleting; default `normal`. */
  readonly variant?: 'normal' | 'primary' | 'danger';
  readonly icon?: IconComponent;
  readonly disabled?: boolean;
  /** Shown as a tooltip, e.g. why the button is disabled. */
  readonly title?: string;
  readonly type?: 'button' | 'submit';
  /** Takes the focus when shown, e.g. Cancel in a confirmation dialog. */
  readonly autoFocus?: boolean;
  /** SDK 1.2.0: for a button that opens a menu or a popover, whether it is open now (`aria-expanded`). */
  readonly expanded?: boolean;
  /** SDK 1.2.0: what the button opens (`aria-haspopup`), with `expanded`. */
  readonly hasPopup?: PopupKind;
}

/** SDK 1.2.0: what a button opens, as `aria-haspopup` names it. */
export type PopupKind = 'menu' | 'listbox' | 'dialog';

export function Button(props: ButtonProps): ReactNode {
  return (
    <button
      type={props.type ?? 'button'}
      className={cx('emc2-button', props.variant === 'primary' && 'emc2-button-primary', props.variant === 'danger' && 'emc2-button-danger')}
      disabled={props.disabled}
      title={props.title}
      autoFocus={props.autoFocus}
      aria-expanded={props.expanded}
      aria-haspopup={props.hasPopup}
      onClick={props.onClick}
    >
      {props.icon === undefined ? null : <Icon icon={props.icon} />}
      <span>{props.children}</span>
    </button>
  );
}

export interface IconButtonProps {
  readonly icon: IconComponent;
  /** The accessible name, and the tooltip unless `title` gives one. */
  readonly label: string;
  /** SDK 1.2.0 (CR-0024): the tooltip, e.g. why the button is disabled; default `label`. The accessible name stays `label`. */
  readonly title?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  /** SDK 1.2.0: for a button that opens a menu or a popover, whether it is open now (`aria-expanded`). */
  readonly expanded?: boolean;
  /** SDK 1.2.0: what the button opens (`aria-haspopup`), with `expanded`. */
  readonly hasPopup?: PopupKind;
}

/** A button with only an icon; `label` is its accessible name and, without `title`, its tooltip. */
export function IconButton(props: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="emc2-icon-button"
      aria-label={props.label}
      title={props.title ?? props.label}
      aria-pressed={props.pressed}
      aria-expanded={props.expanded}
      aria-haspopup={props.hasPopup}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon icon={props.icon} />
    </button>
  );
}

/**
 * A labelled text field. `error` marks it invalid and shows the reason under it, linked to the
 * input with `aria-describedby` (SDK 1.2.0), so that it is read once, as a description.
 */
export function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Called on Enter and when the field loses focus, the commit points of the design pattern. It may come twice for one edit (Enter, then blur): commit only a value that changed. */
  readonly onCommit?: () => void;
  readonly placeholder?: string;
  readonly error?: string;
  readonly disabled?: boolean;
  /** Coordinates, date-time groups, counts: the data font. */
  readonly data?: boolean;
  /** SDK 1.2.0: shown and focusable, but not editable (unlike `disabled`), e.g. a value the user may copy. */
  readonly readOnly?: boolean;
  /** SDK 1.2.0: the on-screen keyboard to offer, e.g. `decimal` for numbers. */
  readonly inputMode?: 'text' | 'decimal' | 'numeric' | 'search' | 'email' | 'tel' | 'url';
  /** SDK 1.2.0: the browser's autofill hint; `off` for values that are not personal, e.g. coordinates. */
  readonly autoComplete?: string;
  /** SDK 1.2.0: whether the browser checks the spelling; `false` for codes, names and coordinates. */
  readonly spellCheck?: boolean;
}): ReactNode {
  const id = useId();
  return (
    <div className="emc2-field">
      <label className="emc2-field-label" htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        className={cx('emc2-input', props.data === true && 'emc2-data')}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        readOnly={props.readOnly}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        spellCheck={props.spellCheck}
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={props.error === undefined ? undefined : `${id}-error`}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        onBlur={props.onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onCommit?.();
        }}
      />
      {props.error === undefined ? null : (
        <span id={`${id}-error`} className="emc2-field-error">
          {props.error}
        </span>
      )}
    </div>
  );
}

/** A colour as the model stores it, `#RRGGBB` in either case (the leading `#` may be left out when typed). */
const HEX_COLOR = /^#?([0-9a-f]{6})$/i;

/**
 * A colour field (CR-0018): the browser's colour picker as a swatch, and the colour as text, e.g.
 * for a shape's outline and fill.
 *
 * `value` is `#RRGGBB` in either case; `onChange` always gets a valid colour in lower case
 * (`#rrggbb`), from the picker or from typed text. While the typed text is not a colour, the field
 * keeps it and calls nothing; at Enter or when it loses the focus it then says so ("Type a colour
 * as #rrggbb"), or shows `error` when the plugin gives one. A new `value` from the plugin while the
 * field does not have the focus (e.g. another object chosen) replaces kept text. `onCommit` comes as with `TextField`
 * (Enter, leaving the field, commit only a value that changed), and once when the picker closes, so
 * that one pick sends one change request.
 *
 * @example
 * <ColorField label="Fill colour" value={style.fillColor ?? '#1f3a93'} onChange={setFill} onCommit={save} />
 */
export function ColorField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onCommit?: () => void;
  readonly disabled?: boolean;
  readonly error?: string;
}): ReactNode {
  const id = useId();
  const swatch = useRef<HTMLInputElement>(null);
  /** Typed text, and the value it was typed over; dropped when the value changes while the field is not focused. */
  const [draft, setDraft] = useState<{ readonly text: string; readonly base: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [focused, setFocused] = useState(false);
  const onCommit = useRef(props.onCommit);
  useLayoutEffect(() => {
    onCommit.current = props.onCommit;
  });
  // The picker's own change event comes when it closes; React's onChange comes on every move.
  useLayoutEffect(() => {
    const el = swatch.current;
    if (el === null) return undefined;
    const commit = () => onCommit.current?.();
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, []);
  const value = props.value.toLowerCase();
  const kept = draft !== null && (focused || draft.base === value) ? draft : null;
  const commitText = () => {
    if (kept !== null && !HEX_COLOR.test(kept.text.trim())) {
      setInvalid(true);
      return;
    }
    setDraft(null);
    setInvalid(false);
    props.onCommit?.();
  };
  const error = props.error ?? (invalid && kept !== null ? 'Type a colour as #rrggbb, e.g. #1f3a93' : undefined);
  return (
    <div className="emc2-field">
      <label className="emc2-field-label" htmlFor={id}>
        {props.label}
      </label>
      <div className="emc2-color-row">
        <input
          ref={swatch}
          type="color"
          className="emc2-color-swatch"
          aria-label={`${props.label}, picker`}
          value={HEX_COLOR.test(value) ? value : '#000000'}
          disabled={props.disabled}
          onChange={(e) => {
            setDraft(null);
            setInvalid(false);
            props.onChange(e.currentTarget.value.toLowerCase());
          }}
        />
        <input
          id={id}
          className="emc2-input emc2-data"
          value={kept?.text ?? value}
          disabled={props.disabled}
          spellCheck={false}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : `${id}-error`}
          onChange={(e) => {
            const text = e.currentTarget.value;
            const hex = HEX_COLOR.exec(text.trim());
            const colour = hex === null ? null : `#${hex[1]!.toLowerCase()}`;
            setDraft({ text, base: colour ?? value });
            if (colour !== null) {
              setInvalid(false);
              props.onChange(colour);
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitText();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitText();
          }}
        />
      </div>
      {error === undefined ? null : (
        <span id={`${id}-error`} className="emc2-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

export interface SelectOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly disabled?: boolean;
}

/** A labelled choice from a list. */
export function Select<V extends string>(props: {
  readonly label: string;
  readonly value: V;
  readonly options: readonly SelectOption<V>[];
  readonly onChange: (value: V) => void;
  readonly disabled?: boolean;
}): ReactNode {
  return (
    <label className="emc2-field">
      <span className="emc2-field-label">{props.label}</span>
      <select className="emc2-input" value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.currentTarget.value as V)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Checkbox(props: { readonly label: string; readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly disabled?: boolean }): ReactNode {
  return (
    <label className="emc2-checkbox">
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

/** A labelled slider, e.g. the map view's dim level. `format` shows the value next to it. */
export function Slider(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
  readonly format?: (value: number) => string;
  readonly disabled?: boolean;
}): ReactNode {
  const shown = props.format?.(props.value) ?? String(props.value);
  return (
    <label className="emc2-field emc2-slider">
      <span className="emc2-field-label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        aria-valuetext={shown}
        onChange={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <output className="emc2-data">{shown}</output>
    </label>
  );
}

export interface Tab<V extends string> {
  readonly value: V;
  readonly label: string;
}

/** Tabs; the plugin shows the chosen tab's content itself. Every tab is reachable with Tab; Left, Right, Home and End move the choice. */
export function Tabs<V extends string>(props: { readonly label: string; readonly tabs: readonly Tab<V>[]; readonly value: V; readonly onChange: (value: V) => void }): ReactNode {
  const move = (key: string) => {
    const i = props.tabs.findIndex((t) => t.value === props.value);
    const last = props.tabs.length - 1;
    const next = key === 'ArrowRight' ? Math.min(i + 1, last) : key === 'ArrowLeft' ? Math.max(i - 1, 0) : key === 'Home' ? 0 : key === 'End' ? last : -1;
    const tab = next >= 0 ? props.tabs[next] : undefined;
    if (tab !== undefined && tab.value !== props.value) props.onChange(tab.value);
  };
  return (
    <div className="emc2-tabs" role="tablist" aria-label={props.label} onKeyDown={(e) => move(e.key)}>
      {props.tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          className={cx('emc2-tab', t.value === props.value && 'emc2-tab-active')}
          aria-selected={t.value === props.value}
          onClick={() => props.onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconComponent;
  readonly disabled?: boolean;
  /** Items of one group stand together, groups apart by a separator. */
  readonly group?: string;
}

/**
 * A menu of items, e.g. a plugin's own small menu. The object actions use the shell's menu
 * (`ctx.actions.openMenu`), not this.
 *
 * Keys (CR-0019): the first enabled item takes the focus when the menu appears; Up and Down move
 * between the enabled items and wrap, Home and End go to the first and last; Enter and Space choose.
 * The menu is one Tab stop. Since it takes the focus when it appears, it is for menus that open on
 * demand (e.g. in a `Popover` after a click), not for a menu that is always on the page.
 */
export function Menu(props: { readonly label: string; readonly items: readonly MenuItem[]; readonly onChoose: (id: string) => void }): ReactNode {
  const root = useRef<HTMLUListElement>(null);
  const onFocus = useRovingTabIndex(root, MENU_ITEM);
  useLayoutEffect(() => {
    const el = root.current;
    if (el !== null) itemsOf(el, MENU_ITEM)[0]?.focus();
  }, []);
  const out: ReactNode[] = [];
  let group: string | undefined;
  props.items.forEach((item, i) => {
    if (i > 0 && item.group !== group) out.push(<li key={`sep-${i}`} className="emc2-menu-separator" role="separator" />);
    group = item.group;
    out.push(
      <li key={item.id} role="none">
        <button type="button" role="menuitem" className="emc2-menu-item" disabled={item.disabled} onClick={() => props.onChoose(item.id)}>
          {item.icon === undefined ? null : <Icon icon={item.icon} />}
          <span>{item.label}</span>
        </button>
      </li>,
    );
  });
  return (
    <ul
      ref={root}
      className="emc2-menu"
      role="menu"
      aria-label={props.label}
      onFocus={onFocus}
      onKeyDown={(e) => {
        const el = root.current;
        const next = el === null || !isNavigationKey(e) ? undefined : nextItem(itemsOf(el, MENU_ITEM), globalThis.document.activeElement, e.key, true);
        if (next === undefined) return;
        e.preventDefault();
        next.focus();
      }}
    >
      {out}
    </ul>
  );
}

/**
 * A small floating panel anchored to a control, e.g. the bookmarks control's tree in the top bar.
 * The plugin shows it while `open`, and closes it on `onClose`. **The plugin owns the focus:** move
 * it into the popover when it opens (e.g. `autoFocus` on its first control), so that Escape reaches
 * it, and back to the control when it closes.
 *
 * It is drawn in the browser's top layer (`popover="manual"`, CR-0021), above everything in the
 * page, so no container clips or covers it; it stays where it is rendered in the page, so the Tab
 * order and a plugin's own `contains` checks are as for any element. It is placed against `anchor`,
 * by default the element it is rendered in (put the control and the popover in one wrapper): below
 * it and lined up with its start, moved as far as it must to stay in the window, above it when
 * there is more room there, scrolling when it is taller, and following it when the window is
 * resized or scrolled.
 *
 * Escape inside it, and a pointer press outside both the panel and its anchor, call `onClose`.
 * **SDK 1.2.0:** a press inside an open dialog that is not around the popover (e.g. its own
 * `ConfirmDialog`, opened meanwhile) is not a press outside, so the popover stays open behind it; a
 * press in a dialog around the popover's anchor still is. `onClose` is a request: the plugin may
 * keep the popover open, e.g. while its own confirmation is open. A popover rendered inside this
 * one's content is inside it. Where the browser has no `popover` attribute (jsdom in tests), the
 * panel is a plain element with the same role, label and behaviour.
 */
export function Popover(props: {
  readonly open: boolean;
  readonly label: string;
  readonly onClose: () => void;
  readonly children?: ReactNode;
  /** The element the popover is placed against (CR-0021), as a ref from `useRef` (a new object on every render places it again each time). Default: the element it is rendered in. */
  readonly anchor?: { readonly current: HTMLElement | null };
}): ReactNode {
  return props.open ? (
    <PopoverPanel label={props.label} onClose={props.onClose} anchor={props.anchor}>
      {props.children}
    </PopoverPanel>
  ) : null;
}

function PopoverPanel(props: {
  readonly label: string;
  readonly onClose: () => void;
  readonly anchor: { readonly current: HTMLElement | null } | undefined;
  readonly children?: ReactNode;
}): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  useLayoutEffect(() => {
    onClose.current = props.onClose;
  });
  const anchorRef = props.anchor;
  useLayoutEffect(() => {
    const box = panel.current;
    const anchor = anchorRef?.current ?? box?.parentElement ?? null;
    if (box === null || anchor === null) return undefined;
    // Set here, not in the markup: without the feature, a [popover] that is not open stays hidden.
    const topLayer = typeof box.showPopover === 'function';
    if (topLayer) {
      box.setAttribute('popover', 'manual');
      box.showPopover();
    }
    const place = () => {
      // Measured at the window's corner without limits, so that the size is the content's own; the
      // panel's own scroll position survives the measurement.
      const scrollTop = box.scrollTop;
      Object.assign(box.style, { left: '0px', top: '0px', maxWidth: '', maxHeight: '' });
      const at = placePopover(anchor.getBoundingClientRect(), { width: box.offsetWidth, height: box.offsetHeight }, { width: globalThis.innerWidth, height: globalThis.innerHeight });
      Object.assign(box.style, { left: `${at.left}px`, top: `${at.top}px`, maxWidth: `${at.maxWidth}px`, maxHeight: `${at.maxHeight}px` });
      box.scrollTop = scrollTop;
      box.dataset['side'] = at.side;
    };
    const onScroll = (e: Event) => {
      // Scrolling inside the panel does not move it (and must not reset its own scroll position).
      if (!(e.target instanceof Node && box.contains(e.target))) place();
    };
    const onPointerDown = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Node) || box.contains(target) || anchor.contains(target)) return;
      // A press in an open dialog that is not around the popover (e.g. its own ConfirmDialog) is not
      // "outside": the dialog is above it. A dialog around the popover's anchor is part of the page.
      const element = target instanceof Element ? target : target.parentElement;
      const dialog = element?.closest('dialog') ?? null;
      if (dialog !== null && dialog.open && !dialog.contains(anchor)) return;
      onClose.current();
    };
    place();
    globalThis.addEventListener('resize', place);
    globalThis.addEventListener('scroll', onScroll, true);
    globalThis.document.addEventListener('pointerdown', onPointerDown, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
    if (content.current !== null) observer?.observe(content.current);
    return () => {
      globalThis.removeEventListener('resize', place);
      globalThis.removeEventListener('scroll', onScroll, true);
      globalThis.document.removeEventListener('pointerdown', onPointerDown, true);
      observer?.disconnect();
      if (topLayer && box.isConnected) box.hidePopover();
    };
  }, [anchorRef]);
  return (
    <div
      ref={panel}
      className="emc2-popover"
      role="dialog"
      aria-label={props.label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <div ref={content}>{props.children}</div>
    </div>
  );
}

/**
 * Asks before something that cannot be undone. `confirmLabel` names the action, e.g. "Delete 3
 * objects". Cancel takes the focus when it opens, so Escape and Enter are safe at once.
 *
 * A modal `<dialog>` in the browser's top layer (CR-0021), above everything in the page, wherever
 * the plugin renders it: the rest of the page is inert and the focus stays in it while it is open,
 * and goes back to where it was when it closes. Escape calls `onCancel`, also when the browser
 * closes the dialog itself. Where the browser has no `showModal` (jsdom in tests), it is an open
 * `<dialog>` in the page with the same role, label, focus and keys.
 */
export function ConfirmDialog(props: {
  readonly open: boolean;
  readonly title: string;
  readonly message: ReactNode;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  return props.open ? <ConfirmDialogBox {...props} /> : null;
}

function ConfirmDialogBox(props: {
  readonly title: string;
  readonly message: ReactNode;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const box = useRef<HTMLDialogElement>(null);
  const modal = useRef(false);
  const onCancel = useRef(props.onCancel);
  useLayoutEffect(() => {
    onCancel.current = props.onCancel;
  });
  useLayoutEffect(() => {
    const dialog = box.current;
    if (dialog === null) return undefined;
    modal.current = typeof dialog.showModal === 'function';
    if (modal.current) dialog.showModal();
    else dialog.setAttribute('open', '');
    // After showModal: React's autoFocus runs while the dialog is still closed. Cancel is the first button.
    dialog.querySelector<HTMLButtonElement>('.emc2-dialog-buttons button')?.focus();
    // Escape: the dialog stays open until the plugin closes it. If the browser closes it anyway (it
    // may ignore a second prevented Escape), that is a cancel too.
    const onCancelEvent = (e: Event) => {
      e.preventDefault();
      onCancel.current();
    };
    // Only a close that left the dialog closed: in StrictMode (the shell's dev build) the cleanup's
    // close() fires its event after the effect has opened the dialog again.
    const onCloseEvent = () => {
      if (!dialog.open) onCancel.current();
    };
    dialog.addEventListener('cancel', onCancelEvent);
    dialog.addEventListener('close', onCloseEvent);
    return () => {
      dialog.removeEventListener('cancel', onCancelEvent);
      dialog.removeEventListener('close', onCloseEvent);
      // close() before the element goes, so that the browser gives the focus back.
      if (modal.current && dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={box}
      className="emc2-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-label={props.title}
      onKeyDown={(e) => {
        // In the top layer the browser turns Escape into the cancel event above.
        if (e.key === 'Escape' && !modal.current) props.onCancel();
      }}
    >
      <div className="emc2-dialog">
        <h2 className="emc2-dialog-title">{props.title}</h2>
        <div className="emc2-dialog-message">{props.message}</div>
        <div className="emc2-dialog-buttons">
          <Button onClick={props.onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant={props.danger === true ? 'danger' : 'primary'} onClick={props.onConfirm}>
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** A short message in a panel, e.g. "You may not edit objects" or "Not in view". */
export function Notice(props: { readonly severity?: 'info' | 'warning' | 'error'; readonly children: ReactNode }): ReactNode {
  const severity = props.severity ?? 'info';
  return (
    <div className={cx('emc2-notice', `emc2-notice-${severity}`)} role={severity === 'error' ? 'alert' : 'status'}>
      {props.children}
    </div>
  );
}

/**
 * A list of rows; with selectable rows, the plugin keeps the selection (e.g. the map's, for
 * `object-list`).
 *
 * Keys (CR-0019): the list is one Tab stop (the row that had the focus last, else the first
 * selected row, else the first); Up and Down move the focus to the previous and next row, Home and
 * End to the first and last. They do not select (owner, 2026-10-16): Space selects the focused row,
 * Ctrl or Cmd with Space adds or removes it, Enter activates it.
 */
export function List(props: { readonly label: string; readonly multiselect?: boolean; readonly children?: ReactNode }): ReactNode {
  const root = useRef<HTMLUListElement>(null);
  const onFocus = useRovingTabIndex(root, LIST_ROW, '[aria-selected="true"]');
  return (
    <ul
      ref={root}
      className="emc2-list"
      role="listbox"
      aria-label={props.label}
      aria-multiselectable={props.multiselect}
      onFocus={onFocus}
      onKeyDown={(e) => {
        const el = root.current;
        const current = globalThis.document.activeElement?.closest(LIST_ROW) ?? null;
        const next = el === null || !isNavigationKey(e) ? undefined : nextItem(itemsOf(el, LIST_ROW), current, e.key, false);
        if (next === undefined) return;
        e.preventDefault();
        next.focus();
      }}
    >
      {props.children}
    </ul>
  );
}

/** One row of a {@link List}. `onSelect` gets whether Ctrl or Cmd was held (add or remove, as on the map). */
export function ListRow(props: {
  readonly selected?: boolean;
  readonly onSelect?: (additive: boolean) => void;
  readonly onActivate?: () => void;
  readonly onMenu?: (at: readonly [x: number, y: number]) => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <li
      className={cx('emc2-list-row', props.selected === true && 'emc2-list-row-selected')}
      role="option"
      aria-selected={props.selected === true}
      tabIndex={0}
      onClick={(e) => props.onSelect?.(e.ctrlKey || e.metaKey)}
      onDoubleClick={props.onActivate}
      onContextMenu={(e) => {
        if (props.onMenu === undefined) return;
        e.preventDefault();
        props.onMenu([e.clientX, e.clientY]);
      }}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          // Space selects; it must not also scroll the pane by a page.
          e.preventDefault();
          props.onSelect?.(e.ctrlKey || e.metaKey);
        }
        if (e.key === 'Enter') props.onActivate?.();
      }}
    >
      {props.children}
    </li>
  );
}

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconComponent;
  /** Present for a folder (also an empty one). */
  readonly children?: readonly TreeNode[];
}

/** Where a dragged node was dropped in a {@link Tree} (CR-0019). */
export interface TreeDrop {
  /** The node that was dragged. */
  readonly id: string;
  /** The folder it was dropped into; null is the top level. */
  readonly parentId: string | null;
  /** Where in that folder: before the node standing at this position of the folder's list *after the dragged node has been taken out of it*; the length of the list means the end. */
  readonly index: number;
}

/**
 * A tree of folders and items, e.g. bookmarks. The plugin keeps which folders are open.
 *
 * Keys (CR-0019, the WAI-ARIA tree pattern): the tree is one Tab stop (the item that had the focus
 * last, else the selected one, else the first). Up and Down move to the previous and next visible
 * item, Home and End to the first and last; Right opens a closed folder (`onToggle`), and on an open
 * one moves to its first child; Left closes an open folder, and on a closed folder or an item moves
 * to the folder above it. Enter and Space do what a click does.
 *
 * Drag and drop (CR-0019; mouse and pen, "Move to…" is the keyboard way): with `onDrop`, every node
 * can be dragged. A drop on the middle half of a folder row puts the node into that folder at its
 * end, and one on its top or bottom quarter before or after the folder (owner, 2026-10-16, so that
 * folders can be reordered too); a drop on the upper or lower half of any other row puts it before
 * or after that row, in that row's folder. A line marks the place, a frame a folder it goes into. `canDrop` is asked while dragging, and a place it refuses shows as not
 * allowed; a node is never dropped on itself or below itself. The tree changes nothing itself: the
 * plugin moves the node in its own data (the plugin still checks in `onDrop`) and passes the new
 * `nodes` back.
 */
export function Tree(props: {
  readonly label: string;
  readonly nodes: readonly TreeNode[];
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onChoose: (id: string) => void;
  readonly selected?: string | null;
  readonly onDrop?: (drop: TreeDrop) => void;
  readonly canDrop?: (id: string, parentId: string | null) => boolean;
}): ReactNode {
  const root = useRef<HTMLUListElement>(null);
  const onFocus = useRovingTabIndex(root, TREE_ITEM, '.emc2-tree-item-selected');
  const dragged = useRef<string | null>(null);
  const [marker, setMarker] = useState<{ readonly id: string; readonly place: DropPlace } | null>(null);
  const onDrop = props.onDrop;

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const el = root.current;
    const current = globalThis.document.activeElement?.closest<HTMLElement>(TREE_ITEM) ?? null;
    if (el === null || !isNavigationKey(e)) return;
    const next = nextItem(itemsOf(el, TREE_ITEM), current, e.key, false);
    if (next !== undefined) {
      e.preventDefault();
      next.focus();
      return;
    }
    const item = current?.closest<HTMLElement>('[role="treeitem"]');
    const id = item?.dataset['id'];
    if ((e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') || item === null || item === undefined || id === undefined) return;
    e.preventDefault();
    const expanded = item.getAttribute('aria-expanded');
    if (e.key === 'ArrowRight') {
      if (expanded === 'false') props.onToggle(id);
      else if (expanded === 'true') item.querySelector<HTMLElement>(`:scope > ul > li > ${TREE_ITEM}`)?.focus();
    } else if (expanded === 'true') props.onToggle(id);
    else item.parentElement?.closest('[role="treeitem"]')?.querySelector<HTMLElement>(`:scope > ${TREE_ITEM}`)?.focus();
  };

  /** The drop at the pointer over row `n`, or null where the tree or the plugin refuses it. */
  const dropAt = (e: DragEvent<HTMLButtonElement>, n: TreeNode): { readonly drop: TreeDrop; readonly place: DropPlace } | null => {
    const id = dragged.current;
    if (id === null) return null;
    const box = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - box.top) / box.height;
    const place: DropPlace = n.children === undefined ? (y < 0.5 ? 'before' : 'after') : y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
    const drop = dropTarget(props.nodes, id, n.id, place);
    if (drop === null || props.canDrop?.(drop.id, drop.parentId) === false) return null;
    return { drop, place };
  };

  const dragProps = (n: TreeNode) =>
    onDrop === undefined
      ? {}
      : {
          draggable: true,
          onDragStart: (e: DragEvent<HTMLButtonElement>) => {
            dragged.current = n.id;
            const data = e.dataTransfer as DataTransfer | null;
            if (data !== null) {
              data.effectAllowed = 'move';
              data.setData('text/plain', n.label);
            }
          },
          onDragOver: (e: DragEvent<HTMLButtonElement>) => {
            const at = dropAt(e, n);
            const data = e.dataTransfer as DataTransfer | null;
            if (at === null) {
              if (data !== null) data.dropEffect = 'none';
              setMarker((m) => (m === null ? m : null));
              return;
            }
            e.preventDefault();
            if (data !== null) data.dropEffect = 'move';
            setMarker((m) => (m !== null && m.id === n.id && m.place === at.place ? m : { id: n.id, place: at.place }));
          },
          onDragLeave: () => setMarker((m) => (m !== null && m.id === n.id ? null : m)),
          onDrop: (e: DragEvent<HTMLButtonElement>) => {
            const at = dropAt(e, n);
            e.preventDefault();
            dragged.current = null;
            setMarker(null);
            if (at !== null) onDrop(at.drop);
          },
          onDragEnd: () => {
            dragged.current = null;
            setMarker(null);
          },
        };

  const render = (nodes: readonly TreeNode[], level: number): ReactNode[] =>
    nodes.map((n) => {
      const folder = n.children !== undefined;
      const open = folder && props.expanded.has(n.id);
      return (
        <li key={n.id} role="treeitem" data-id={n.id} aria-level={level} aria-expanded={folder ? open : undefined} aria-selected={props.selected === n.id}>
          <button
            type="button"
            className={cx('emc2-tree-item', props.selected === n.id && 'emc2-tree-item-selected', marker !== null && marker.id === n.id && `emc2-tree-drop-${marker.place}`)}
            onClick={() => (folder ? props.onToggle(n.id) : props.onChoose(n.id))}
            {...dragProps(n)}
          >
            {n.icon === undefined ? null : <Icon icon={n.icon} />}
            <span>{n.label}</span>
          </button>
          {open && n.children !== undefined && n.children.length > 0 ? <ul role="group">{render(n.children, level + 1)}</ul> : null}
        </li>
      );
    });
  return (
    <ul ref={root} className="emc2-tree" role="tree" aria-label={props.label} onFocus={onFocus} onKeyDown={onKeyDown}>
      {render(props.nodes, 1)}
    </ul>
  );
}
export { DeclaredFields } from './fields.tsx';
export { CHIP_ICONS, Chip, PanelFoot, TileGrid, nextTile, type ChipTone, type Tile, type TileGroup } from './design.tsx';
export { FloatingWindow, WINDOW_DEFAULT_SIZE, WINDOW_MIN_SIZE, WINDOW_OFFSET, WINDOW_STEP, WINDOW_STEP_SHIFT, clampWindow, type WindowSize } from './window.tsx';
