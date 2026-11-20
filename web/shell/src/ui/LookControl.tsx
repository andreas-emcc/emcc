import { Button, Popover, Select, type Density, type Look } from '@emc2/plugin-sdk';
import { Palette } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ShellStore, ShellView } from './store.ts';
import { LOOK_DENSITY, LOOK_NAMES, LOOKS, lookOf, type LookChoice } from './theme.ts';

const DENSITY_NAMES: Readonly<Record<Density, string>> = { compact: 'Compact', comfortable: 'Comfortable' };

/**
 * The look control in the top bar, before the setups control (ADR-0034; owner, 2026-10-17): every
 * user chooses the look (the installation's default, or one of the three), light or dark (as the
 * computer is, or one of them) and the density (the look's default, or one of the two). A choice
 * applies at once and is part of the user's setup.
 */
export function LookControl({ view, store }: { readonly view: ShellView; readonly store: ShellStore }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const choice = view.look;
  const look = lookOf(choice, view.installationLook);
  const change = (part: Partial<LookChoice>) => { store.setLook({ ...choice, ...part }); };
  const close = () => {
    setOpen(false);
    button.current?.querySelector<HTMLElement>(':scope > button')?.focus();
  };
  // The focus moves into it when it opens, so that Escape works at once.
  useEffect(() => {
    if (open) body.current?.querySelector<HTMLElement>('select')?.focus();
  }, [open]);
  return (
    <div className="look-control" ref={button}>
      <Button icon={Palette} title="Look" onClick={() => { if (open) close(); else setOpen(true); }}>
        Look
      </Button>
      <Popover open={open} label="Look" onClose={close}>
        <div className="look-popover" ref={body}>
          <Select<Look | 'default'>
            label="Look"
            value={choice.look}
            options={[
              { value: 'default', label: `Installation default (${LOOK_NAMES[view.installationLook]})` },
              ...LOOKS.map((l) => ({ value: l, label: LOOK_NAMES[l] })),
            ]}
            onChange={(value) => { change({ look: value }); }}
          />
          <Select<'system' | 'light' | 'dark'>
            label="Light or dark"
            value={choice.scheme}
            options={[{ value: 'system', label: 'As the computer is' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
            onChange={(value) => { change({ scheme: value }); }}
          />
          <Select<Density | 'look'>
            label="Density"
            value={choice.density}
            options={[
              { value: 'look', label: `The look's default (${DENSITY_NAMES[LOOK_DENSITY[look]]})` },
              { value: 'compact', label: DENSITY_NAMES.compact },
              { value: 'comfortable', label: DENSITY_NAMES.comfortable },
            ]}
            onChange={(value) => { change({ density: value }); }}
          />
        </div>
      </Popover>
    </div>
  );
}
