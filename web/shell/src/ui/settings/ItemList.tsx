/**
 * A settings list as a table with a side form (T-203 part D; the UXA's design, owner 2026-11-13 "Table
 * + side form"; SDK 1.8.0 `x-emc2.item`). One of a plugin's top-level lists of objects: a row per item
 * (its name, its columns, its On or Off chip), "Add", and the selected item's form beside the table.
 *
 * Each item is its own editing surface (the UXA's "Saving: one rule"; owner D1 A): its form saves the
 * plugin's saved values with only that item changed, and keeps its unsaved draft while another row is
 * chosen. Delete (after its question) and Move up or down change the list itself and save at once (D2
 * A). A new item lives only in its form until its first Save, which appends it. Rows are kept by the
 * items' stable ids where the list declares `item.id` (CR-0047), else by their places.
 */
import { Button, Chip, ConfirmDialog, IconButton, itemColumns, itemId, itemName, itemWords, uuidv7, type SettingsSchema } from '@emc2/plugin-sdk';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { LayerCreator } from '../../layers/creator.ts';
import type { KnownLayers } from '../../layers/known.ts';
import type { CredentialNames } from './credentials.ts';
import type { Answer } from './api.ts';
import type { Drafts } from './drafts.ts';
import { SettingsForm } from './SettingsForm.tsx';
import { asObject, cellText, itemDraftKey, itemsOf, newItem } from './items.ts';
import { emptyOf, labelOf, type Field, type Json, type JsonObject } from './schema.ts';

const NEW = 'new';

export interface ItemListProps {
  /** The entry's draft key, e.g. `plugin/gmti`. */
  readonly entryKey: string;
  /** The list's property in the plugin's settings. */
  readonly name: string;
  /** The list's schema, with its `x-emc2.item`. */
  readonly list: SettingsSchema;
  /** The items' form. */
  readonly field: Field;
  /** The plugin's saved values, kept current by the caller. */
  readonly values: JsonObject;
  readonly drafts: Drafts;
  /** Saves the plugin's complete values; the answer is the saved values. */
  readonly save: (values: JsonObject) => Promise<Answer<JsonObject>>;
  readonly layers?: KnownLayers;
  readonly creator?: LayerCreator;
  readonly credentials?: CredentialNames;
}

export function ItemList({ entryKey, name, list, field, values, drafts, save, layers, creator, credentials }: ItemListProps) {
  const items = useMemo(() => itemsOf(values, name), [values, name]);
  const rows = items.map((item, i) => itemId(list, item) ?? `@${String(i)}`);
  const words = itemWords(list);
  const columns = itemColumns(list);
  const stateKey = list['x-emc2']?.item?.state;
  const properties = list.items?.properties ?? {};
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Json | null>(null);
  const [asking, setAsking] = useState<string | null>(null); // the row, so that a change meanwhile cannot delete another
  const [adopt, setAdopt] = useState<string | null>(null); // a new item's row once saved, chosen when it arrives
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  useSyncExternalStore(drafts.subscribe, () => drafts.keys()); // the rows' unsaved marks
  const keyOf = (row: string) => itemDraftKey(entryKey, name, row);
  const markRefused = (row: string, bad: boolean) => {
    setRefused((set) => {
      if (set.has(row) === bad) return set;
      const next = new Set(set);
      if (bad) next.add(row);
      else next.delete(row);
      return next;
    });
  };

  const withItems = (next: readonly Json[]): JsonObject => ({ ...values, [name]: next });
  /** Delete and Move: the list changes and is saved at once (D2 A). */
  const change = async (next: readonly Json[], after: () => void) => {
    setBusy(true);
    setFailed(null);
    const answer = await save(withItems(next));
    setBusy(false);
    if (answer.ok) after();
    else setFailed(answer.problems.length === 0 ? answer.message : `${answer.message} ${answer.problems.map((p) => `${p.path}: ${p.problem}`).join('; ')}`);
  };
  /** Rows kept by place: their drafts and "Not saved" marks move with them (`order[newPlace] = oldPlace`). */
  const moveDrafts = (order: readonly number[]) => {
    if (rows.every((r) => !r.startsWith('@'))) return;
    const at = (i: number) => `@${String(i)}`;
    const moved = order.map((from) => drafts.get(keyOf(at(from))));
    rows.forEach((_, i) => { drafts.drop(keyOf(at(i))); });
    moved.forEach((d, i) => { if (d !== undefined) drafts.edit(keyOf(at(i)), d.base, d.value); });
    setRefused((set) => new Set([...[...set].filter((r) => !r.startsWith('@')), ...order.flatMap((from, i) => (set.has(at(from)) ? [at(i)] : []))]));
  };
  const remove = (i: number) => {
    const row = rows[i] ?? '';
    void change(items.filter((_, j) => j !== i), () => {
      drafts.drop(keyOf(row));
      moveDrafts(items.map((_, j) => j).filter((j) => j !== i));
      setSelected(null);
    });
  };
  const move = (i: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item ?? null);
    const order = items.map((_, j) => j);
    const [from] = order.splice(i, 1);
    order.splice(i + by, 0, from ?? i);
    void change(next, () => {
      moveDrafts(order);
      if (rows[i]?.startsWith('@') === true) setSelected(`@${String(i + by)}`);
    });
  };
  // A new item, once saved, is chosen by its row when the saved values bring it; until then its form stays
  if (adopt !== null && rows.includes(adopt)) { // adjusted while rendering, as React advises for state that follows props
    setSelected(adopt);
    setFresh(null);
    setAdopt(null);
  }
  /** The user's choice of row: it wins over a new item's adoption. */
  const choose = (row: string | null) => {
    setAdopt(null);
    setSelected(row);
  };
  const add = () => {
    if (fresh === null) setFresh(newItem(list, emptyOf(field), uuidv7)); // CR-0047 F3: its id from the start
    choose(NEW);
  };

  const index = selected === null || selected === NEW ? -1 : rows.indexOf(selected);
  const isNew = selected === NEW && fresh !== null;
  const shownItem = isNew ? fresh : index >= 0 ? items[index] : undefined;
  const head = shownItem === undefined ? null : itemName(list, shownItem, isNew ? items.length : index, !isNew);
  const stateOf = (item: Json | undefined) => {
    const record = asObject(item);
    return stateKey === undefined || record === null ? null : record[stateKey] === true;
  };
  const chip = (item: Json | undefined) => {
    const on = stateOf(item);
    return on === null ? null : <Chip tone={on ? 'ok' : 'neutral'} label={on ? 'On' : 'Off'} />;
  };
  const unsaved = (row: string) => drafts.count(keyOf(row));
  const count = items.length;
  const title = list.title ?? labelOf(name);

  const saveItem = (i: number | null) => async (item: JsonObject): Promise<Answer<JsonObject>> => {
    const next = i === null ? [...items, item] : items.map((x, j) => (j === i ? item : x));
    const answer = await save(withItems(next));
    if (!answer.ok) return answer;
    const savedItems = itemsOf(answer.value, name);
    return { ok: true, value: asObject(savedItems[i ?? savedItems.length - 1]) ?? item };
  };

  return (
    <section className="settings-item-list" aria-label={title}>
      <h3>{title}</h3>
      <div className="settings-item-split">
        <div className="settings-item-table">
          <div className="settings-item-bar">
            <span className="muted">{`${String(count)} ${words.noun}${count === 1 ? '' : 's'}`}</span>
            <Button icon={Plus} onClick={add} disabled={busy}>{words.add}</Button>
          </div>
          {failed !== null && <p role="alert" className="settings-refused">{failed}</p>}
          <table>
            <thead>
              <tr>
                <th scope="col">{properties[list['x-emc2']?.item?.name ?? '']?.title ?? 'Name'}</th>
                {columns.map((c) => <th key={c} scope="col">{properties[c]?.title ?? labelOf(c)}</th>)}
                {stateKey !== undefined && <th scope="col">{properties[stateKey]?.title ?? labelOf(stateKey)}</th>}
              </tr>
            </thead>
            <tbody>
              {[...items.map((item, i) => ({ item, row: rows[i] ?? `@${String(i)}`, label: itemName(list, item, i, true) })),
                ...(fresh === null ? [] : [{ item: fresh, row: NEW, label: itemName(list, fresh, items.length, false) }])].map(({ item, row, label }) => {
                const n = unsaved(row);
                const current = row === selected;
                const record = asObject(item) ?? {};
                return (
                  <tr key={row} data-selected={current ? '' : undefined} data-refused={refused.has(row) ? '' : undefined}
                    onClick={() => { choose(row); }}>
                    <th scope="row">
                      <div className="settings-item-cell">
                      <button type="button" className="settings-item-name" aria-current={current ? 'true' : undefined}
                        onClick={(e) => { e.stopPropagation(); choose(row); }}>
                        {label}
                      </button>
                      {n > 0 && <span className="unsaved-count" title={`${String(n)} unsaved`}>{n}</span>}
                      {refused.has(row) && <Chip tone="error" label="Not saved" />}
                      </div>
                    </th>
                    {columns.map((c) => <td key={c}>{cellText(record[c])}</td>)}
                    {stateKey !== undefined && <td>{chip(item)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <aside className="settings-item-form" aria-label={head ?? words.noun}>
          {shownItem === undefined || selected === null ? (
            <p className="muted">{`Select ${/^[aeiou]/.test(words.noun) ? 'an' : 'a'} ${words.noun}, or add one.`}</p>
          ) : (
            <>
              <header className="settings-item-head">
                <h4>{head}</h4>
                {chip(shownItem)}
                {!isNew && (
                  <>
                    <IconButton icon={ArrowUp} label={`Move ${head ?? ''} up`} disabled={busy || index <= 0} onClick={() => { move(index, -1); }} />
                    <IconButton icon={ArrowDown} label={`Move ${head ?? ''} down`} disabled={busy || index >= count - 1} onClick={() => { move(index, 1); }} />
                  </>
                )}
                <IconButton icon={X} label="Close" onClick={() => { choose(null); }} />
              </header>
              <SettingsForm
                key={selected}
                draftKey={keyOf(selected)}
                field={field}
                current={(shownItem ?? {}) as JsonObject}
                drafts={drafts}
                at={`/${name}/${String(isNew ? items.length : index)}`}
                saveLabel={`Save ${words.noun}`}
                save={saveItem(isNew ? null : index)}
                onOutcome={(ok) => { markRefused(selected, !ok); }}
                onSaved={(item) => {
                  if (isNew) setAdopt(itemId(list, item) ?? `@${String(items.length)}`);
                }}
                start={(
                  <Button variant="danger" icon={Trash2} disabled={busy}
                    onClick={() => {
                      if (isNew) {
                        drafts.drop(keyOf(NEW));
                        setFresh(null);
                        setSelected(null);
                      } else setAsking(selected);
                    }}>
                    Delete
                  </Button>
                )}
                {...(layers === undefined ? {} : { layers })}
                {...(creator === undefined ? {} : { creator })}
                {...(credentials === undefined ? {} : { credentials })}
              />
            </>
          )}
        </aside>
      </div>
      <ConfirmDialog open={asking !== null && rows.includes(asking)} title={words.remove} danger confirmLabel="Delete"
        message={asking === null || !rows.includes(asking) ? '' : `${itemName(list, items[rows.indexOf(asking)], rows.indexOf(asking), true)} is deleted at once, with its settings.`}
        onConfirm={() => { const i = asking === null ? -1 : rows.indexOf(asking); setAsking(null); if (i >= 0) remove(i); }}
        onCancel={() => { setAsking(null); }} />
    </section>
  );
}
