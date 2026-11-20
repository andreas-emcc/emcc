import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsApi } from '../api.ts';
import { Drafts } from '../drafts.ts';
import { LABELING_DRAFT, LabelingEntry } from './LabelingEntry.tsx';
import { DEFAULT_FORMAT, makeLabel, type Premade } from './model.ts';
import { LabelingState } from './source.ts';

const NATO_SET = { id: 'nato', name: 'NATO', classifications: [
  { name: 'COSMIC TOP SECRET', color: '#c7702a' }, { name: 'SECRET', color: '#b8423a' }, { name: 'CONFIDENTIAL', color: '#3d6fb6' },
  { name: 'RESTRICTED', color: '#8a7a3a' }, { name: 'UNCLASSIFIED', color: '#3f9a5c' },
] };
const SWE_SET = { id: 'swe', name: 'Swedish national', classifications: [
  { name: 'KVALIFICERAT HEMLIG', color: '#c7702a' }, { name: 'HEMLIG', color: '#b8423a' }, { name: 'KONFIDENTIELL', color: '#3d6fb6' },
  { name: 'BEGRÄNSAT HEMLIG', color: '#8a7a3a' }, { name: 'EJ SEKRETESS', color: '#3f9a5c' },
] };
const DEFINITIONS = { classificationSets: [NATO_SET, SWE_SET], policies: [
  { name: 'NATO', classificationSets: ['nato'] }, { name: 'SWE', classificationSets: ['swe', 'nato'] },
] };
const LIST = ['SWE', 'NOR', 'FIN'];
const STORED: Premade = {
  policies: {
    NATO: {
      releasableTo: LIST,
      labels: [makeLabel('NATO', 'RESTRICTED', new Set(['SWE']), LIST), makeLabel('NATO', 'SECRET', new Set(['SWE', 'NOR']), LIST)],
    },
  },
};

afterEach(() => {
  cleanup();
});

async function setUp(stored: Premade = STORED, answer?: (body: unknown) => Response) {
  let server: unknown = stored;
  const puts: unknown[] = [];
  const api = new SettingsApi(vi.fn<typeof fetch>((_input, init) => {
    if (init?.method === 'PUT') {
      const body: unknown = JSON.parse(init.body as string);
      puts.push(body);
      const response = answer?.(body) ?? Response.json(body);
      if (response.ok) server = body;
      return Promise.resolve(response);
    }
    return Promise.resolve(Response.json(server));
  }));
  const drafts = new Drafts();
  const source = new LabelingState();
  source.configured(DEFINITIONS, DEFAULT_FORMAT);
  render(<LabelingEntry api={api} drafts={drafts} source={source} />);
  await screen.findAllByRole('heading', { name: 'Labels' });
  return { drafts, source, puts, setServer: (value: unknown) => { server = value; } };
}

/** The NATO card: the first policy. */
const nato = () => screen.getByRole('region', { name: 'NATO' });
const labels = () => within(nato()).getAllByRole('button', { name: /^NATO / }).map((b) => b.getAttribute('aria-label'));
const group = (name: string) => within(nato()).getByRole('heading', { name, level: 5 }).parentElement as HTMLElement;

describe('Settings › Labeling (T-170 round 3)', () => {
  it('shows the classifications and the labels highest first, each in its colour (OI A, round 3b)', async () => {
    await setUp();
    expect(['NATO', 'SWE'].map((name) => within(screen.getByRole('region', { name })).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)))
      .toEqual([['Classifications', 'Releasable to', 'Labels'], ['Classifications', 'Releasable to', 'Labels']]);
    const ladder = within(nato()).getByRole('list', { name: 'Classifications, highest first' });
    expect(within(ladder).getAllByRole('listitem').map((li) => li.textContent)).toEqual(NATO_SET.classifications.map((c) => c.name));
    expect((ladder.querySelector('.labeling-swatch') as HTMLElement).style.background).toBe('rgb(199, 112, 42)');
    expect(within(nato()).getAllByRole('heading', { level: 5 }).map((h) => h.textContent)).toEqual(['SECRET', 'RESTRICTED']);
    expect(labels()).toEqual(['NATO SECRET \u00B7 REL TO SWE, NOR', 'NATO RESTRICTED \u00B7 REL TO SWE']);
    const band = within(nato()).getByRole('button', { name: 'NATO SECRET \u00B7 REL TO SWE, NOR' }).querySelector('.labeling-cls') as HTMLElement;
    expect(band.textContent).toBe('NATO SECRET');
    expect(band.style.background).toBe('rgb(184, 66, 58)');
  });

  it('gives the Swedish policy its national section and NATO\'s, each with its ladder (owner OY, A3)', async () => {
    await setUp();
    const swe = screen.getByRole('region', { name: 'SWE' });
    expect(within(swe).getAllByRole('list').map((l) => l.getAttribute('aria-label')))
      .toEqual(['Swedish national classifications, highest first', 'NATO classifications, highest first']);
    expect(within(within(swe).getByRole('list', { name: 'Swedish national classifications, highest first' })).getAllByRole('listitem').at(-1)?.textContent)
      .toBe('EJ SEKRETESS');
    fireEvent.click(within(swe).getByRole('button', { name: '+ New label' }));
    const select = within(swe).getByRole('combobox', { name: 'Classification' });
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Swedish national', 'NATO']);
    expect((select as HTMLSelectElement).value, 'the lowest of the first section').toBe('EJ SEKRETESS');
  });

  it('keeps every change until the one Save, marked unsaved, and saves the whole entry (OJ B)', async () => {
    const t = await setUp();
    fireEvent.click(within(nato()).getByRole('button', { name: '+ Add a value' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'New value' }), { target: { value: ' DNK ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(within(nato()).getByRole('button', { name: '+ New label' }));
    const editor = screen.getByRole('group', { name: 'New label' });
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Classification' }), { target: { value: 'CONFIDENTIAL' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'DNK' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'SWE' }));
    expect(within(editor).getByRole('img', { name: 'NATO CONFIDENTIAL \u00B7 REL TO SWE, DNK' }), 'the preview, in the list order').toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Add label' }));

    expect(t.drafts.keys()).toEqual([LABELING_DRAFT]);
    expect(screen.getByText(/unsaved changes?$/)).toBeTruthy();
    expect(t.puts, 'nothing sent before Save').toEqual([]);
    expect(labels()).toContain('NATO CONFIDENTIAL · REL TO SWE, DNK');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); await Promise.resolve(); });
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(t.drafts.keys()).toEqual([]);
    expect(t.puts).toEqual([{
      policies: {
        NATO: {
          releasableTo: ['SWE', 'NOR', 'FIN', 'DNK'],
          labels: [...(STORED.policies.NATO?.labels ?? []), {
            policyIdentifier: { name: 'NATO' }, classification: 'CONFIDENTIAL',
            categories: [{ tagName: 'Releasable To', type: 'permissive', values: ['SWE', 'DNK'] }],
          }],
        },
      },
    }]);
  });

  it('refuses a value in the list already and a label that exists, whatever the order of its values', async () => {
    await setUp();
    fireEvent.click(within(nato()).getByRole('button', { name: '+ Add a value' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'New value' }), { target: { value: 'swe' } });
    expect(screen.getByRole('alert').textContent).toBe('swe is in the list already.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(nato()).getByRole('button', { name: '+ New label' }));
    const editor = screen.getByRole('group', { name: 'New label' });
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Classification' }), { target: { value: 'SECRET' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'NOR' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'SWE' }));
    expect(within(editor).getByRole('alert').textContent)
      .toBe('This label exists already (NATO SECRET · REL TO SWE, NOR). The order of the values does not matter.');
    expect(within(editor).getByRole('button', { name: 'Add label' }).hasAttribute('disabled')).toBe(true);
  });

  it('edits a label in its group, renames a value everywhere, and keeps a used value from removal', async () => {
    await setUp();
    fireEvent.click(screen.getByRole('button', { name: 'NATO RESTRICTED · REL TO SWE' }));
    const editor = within(group('RESTRICTED')).getByRole('group', { name: 'Edit label' });
    fireEvent.click(within(editor).getByRole('button', { name: 'FIN' }));
    expect(within(editor).getByText(/Was: NATO RESTRICTED \u00B7 REL TO SWE$/)).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Change label' }));
    expect(labels()).toContain('NATO RESTRICTED · REL TO SWE, FIN');

    fireEvent.click(screen.getByRole('button', { name: 'SWE: rename or remove' }));
    expect(screen.getByRole('button', { name: 'Remove' }).hasAttribute('disabled'), 'used by both labels').toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Rename SWE' }), { target: { value: 'SE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(labels()).toEqual(['NATO SECRET · REL TO SE, NOR', 'NATO RESTRICTED · REL TO SE, FIN']);
    fireEvent.click(screen.getByRole('button', { name: 'FIN: rename or remove' }));
    expect(screen.getByRole('button', { name: 'Remove' }).hasAttribute('disabled')).toBe(true);
  });

  it('asks before deleting a label, and Discard changes brings back what is saved', async () => {
    const t = await setUp();
    fireEvent.click(screen.getByRole('button', { name: 'NATO SECRET · REL TO SWE, NOR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete label' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this label?' });
    expect(within(dialog).getByText(/Objects and layers that already carry it keep their labels/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(labels()).toEqual(['NATO RESTRICTED · REL TO SWE']);
    expect(t.drafts.keys()).toEqual([LABELING_DRAFT]);

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(labels()).toHaveLength(2);
    expect(t.drafts.keys()).toEqual([]);
  });

  it('reads the labels again when someone else saves, and says so while edits are open', async () => {
    const t = await setUp();
    fireEvent.click(screen.getByRole('button', { name: 'NATO SECRET · REL TO SWE, NOR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete label' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Delete this label?' })).getByRole('button', { name: 'Delete' }));

    t.setServer({ policies: { NATO: { releasableTo: LIST, labels: [makeLabel('NATO', 'UNCLASSIFIED', new Set(), LIST)] } } });
    act(() => { t.source.saved(); });
    expect(await screen.findByText(/Someone else saved the labels while you were editing/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take their labels' }));
    expect(labels()).toEqual(['NATO UNCLASSIFIED']);
  });

  it('puts a label whose classification the configuration no longer has in a group of its own', async () => {
    await setUp({ policies: { NATO: { releasableTo: LIST, labels: [makeLabel('NATO', 'SECRET+', new Set(['SWE']), LIST)] } } });
    expect(within(group('Not in the definitions')).getByText(/no longer has in the labeling definitions/)).toBeTruthy();
    expect((within(nato()).getByRole('button', { name: 'NATO SECRET+ \u00B7 REL TO SWE' }).querySelector('.labeling-cls') as HTMLElement).style.background,
      'grey (A4)').toBe('rgb(85, 93, 104)');
    fireEvent.click(screen.getByRole('button', { name: 'NATO SECRET+ · REL TO SWE' }));
    expect(screen.getByRole('button', { name: 'Change label' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the server\'s problems by the label they are about', async () => {
    await setUp(STORED, () => Response.json({ problems: [{ path: '/policies/NATO/labels/1', problem: 'the same label as /policies/NATO/labels/0' }] }, { status: 400 }));
    fireEvent.click(screen.getByRole('button', { name: 'FIN: rename or remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); await Promise.resolve(); });
    expect(await screen.findByText('NATO SECRET · REL TO SWE, NOR: the same label as /policies/NATO/labels/0')).toBeTruthy();
    expect(screen.getByText(/unsaved changes?$/), 'the edits are kept').toBeTruthy();
  });
});
