import { IconButton, Menu, Popover } from '@emc2/plugin-sdk';
import { CircleQuestionMark } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Health } from '../ServerStatus.tsx';
import { helpItems, MANUAL_PATH, versionLine } from './help.ts';

type Answer = { kind: 'loading' } | { kind: 'ok'; health: Health } | { kind: 'failed' };

/**
 * The "?" button at the right end of the top bar (M9 RC2, owner ACQ): a small menu with the user manual (a new tab)
 * and the version of the release that runs, shown only inside the menu (owner). Both come from `GET /api/health`,
 * asked each time the menu opens.
 */
export function HelpMenu({ doFetch = fetch }: { readonly doFetch?: typeof fetch }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<Answer>({ kind: 'loading' });
  const wrapper = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    wrapper.current?.querySelector<HTMLElement>(':scope > button')?.focus();
  };
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    doFetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        setAnswer({ kind: 'ok', health: (await response.json()) as Health });
      })
      .catch(() => { if (!controller.signal.aborted) setAnswer({ kind: 'failed' }); });
    return () => { controller.abort(); };
  }, [open, doFetch]);
  // The focus moves into the menu, so that Escape works at once; the Menu takes it when it has an enabled item.
  useEffect(() => {
    const el = body.current;
    if (open && el !== null && !el.contains(document.activeElement)) el.focus();
  }, [open, answer]);
  const health = answer.kind === 'ok' ? answer.health : null;
  return (
    <div className="help-control" ref={wrapper}>
      <IconButton icon={CircleQuestionMark} label="Help" expanded={open} hasPopup="menu"
        onClick={() => {
          if (open) {
            close();
          } else {
            setAnswer({ kind: 'loading' });
            setOpen(true);
          }
        }} />
      <Popover open={open} label="Help" onClose={close}>
        <div className="help-popover" ref={body} tabIndex={-1}>
          {answer.kind === 'loading' ? <p className="help-version">Loading…</p> : (
            <>
              <Menu
                label="Help"
                items={helpItems(health ?? {})}
                onChoose={(id) => {
                  if (id === 'manual') window.open(MANUAL_PATH, '_blank', 'noopener');
                  close();
                }}
              />
              <p className="help-version">{versionLine(health?.version)}</p>
            </>
          )}
        </div>
      </Popover>
    </div>
  );
}
