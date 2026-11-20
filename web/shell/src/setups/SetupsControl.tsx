import { Button, ConfirmDialog, IconButton, Notice, Popover, TextField } from '@emc2/plugin-sdk';
import { LayoutDashboard, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import type { NamedSetup, Setups } from './setups.ts';

/**
 * The setups control in the top bar, before the clock (ADR-0031 points 1 and 5): the user's named
 * setups, each restored by a click (owner, 2026-10-16: at once, no question), "Save current setup
 * as" with a name, and a delete button per setup that asks first. Saving under a name that exists
 * asks whether to replace it.
 */
export function SetupsControl({ setups }: { readonly setups: Setups }) {
  const state = useSyncExternalStore(setups.subscribe, setups.getState);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [replacing, setReplacing] = useState<NamedSetup | null>(null);
  const [deleting, setDeleting] = useState<NamedSetup | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setReplacing(null);
    setDeleting(null);
    setNameError(undefined);
    if (returnFocus) rootRef.current?.querySelector<HTMLElement>(':scope > button')?.focus();
  }, []);

  // The focus moves into it when it opens, so that Escape works at once.
  useEffect(() => {
    if (open) bodyRef.current?.querySelector<HTMLElement>('input')?.focus();
  }, [open]);

  const toggle = () => {
    if (open) {
      close(true);
      return;
    }
    setOpen(true);
    setups.clearError();
    void setups.loadNamed();
  };

  const save = async (replace: boolean) => {
    const result = await setups.saveNamed(name, replace);
    setReplacing(null);
    if (result.saved) {
      setName('');
      setNameError(undefined);
    } else if (result.existing !== undefined) {
      setReplacing(result.existing);
    } else {
      setNameError(result.nameError);
    }
    bodyRef.current?.querySelector<HTMLElement>('input')?.focus();
  };

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    void save(false);
  };

  const restore = async (setup: NamedSetup) => {
    if (await setups.restoreNamed(setup.id)) close(true);
  };

  const remove = async (setup: NamedSetup) => {
    setDeleting(null);
    await setups.deleteNamed(setup.id);
    bodyRef.current?.querySelector<HTMLElement>('input')?.focus();
  };

  const named = state.named;
  return (
    <div className="setups-control" ref={rootRef}>
      <Button icon={LayoutDashboard} title="Setups" onClick={toggle}>
        Setups
      </Button>
      {/* Placed against this wrapper, so a press on the button is not a press outside. A press
          outside asks to close it; while a question is open it stays (the question is modal). */}
      <Popover open={open} label="Setups" onClose={() => { if (replacing === null && deleting === null) close(true); }}>
        <div className="setups-popover" ref={bodyRef}>
          {state.error === null ? null : <Notice severity="error">{state.error}</Notice>}
          {named === null
            ? <p className="setups-hint">{state.busy ? 'Reading your setups…' : 'Your setups could not be read.'}</p>
            : named.length === 0
              ? <p className="setups-hint">No named setups yet.</p>
              : (
                <ul className="setups-list" aria-label="Named setups">
                  {named.map((setup) => (
                    <li key={setup.id} className="setups-row">
                      <button
                        type="button"
                        className="setups-restore"
                        aria-label={`Restore ${setup.name}`}
                        title={`Restore ${setup.name}`}
                        disabled={state.busy}
                        onClick={() => { void restore(setup); }}
                      >
                        {setup.name}
                      </button>
                      <IconButton icon={Trash2} label={`Delete ${setup.name}`} disabled={state.busy} onClick={() => { setDeleting(setup); }} />
                    </li>
                  ))}
                </ul>
              )}
          <form className="setups-save" onSubmit={onSubmit}>
            <TextField
              label="Save current setup as"
              value={name}
              onChange={(value) => { setName(value); setNameError(undefined); }}
              placeholder="Name"
              {...(nameError === undefined ? {} : { error: nameError })}
            />
            <Button type="submit" icon={Save} variant="primary" disabled={state.busy || named === null}>
              Save
            </Button>
          </form>
          <ConfirmDialog
            open={replacing !== null}
            title="Replace setup"
            message={`A setup named ${replacing?.name ?? ''} exists. Replace it with the current setup?`}
            confirmLabel="Replace"
            onConfirm={() => { void save(true); }}
            onCancel={() => { setReplacing(null); bodyRef.current?.querySelector<HTMLElement>('input')?.focus(); }}
          />
          <ConfirmDialog
            open={deleting !== null}
            title="Delete setup"
            message={`Delete the setup ${deleting?.name ?? ''}? This cannot be undone.`}
            confirmLabel="Delete"
            danger
            onConfirm={() => { if (deleting !== null) void remove(deleting); }}
            onCancel={() => { setDeleting(null); bodyRef.current?.querySelector<HTMLElement>('input')?.focus(); }}
          />
        </div>
      </Popover>
    </div>
  );
}
