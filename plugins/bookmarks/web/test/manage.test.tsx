import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_NAME, serialize, type TreeItem } from '../src/tree.ts';
import { bookmark, openMenu, seed, setup, stored, trigger } from './support.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const folder = (id: string, name: string, children: TreeItem[] = []): TreeItem => ({ type: 'folder', id, name, children });
const names = (items: readonly TreeItem[]): string[] => items.map((i) => i.name);
const children = (items: readonly TreeItem[], name: string): readonly TreeItem[] => {
  const found = items.find((i) => i.name === name);
  return found?.type === 'folder' ? found.children : [];
};

const row = (name: string) => screen.findByRole('button', { name });
const press = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

async function edit() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit bookmarks' }));
}

async function newFolder(name: string) {
  press('New folder');
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  press('Create folder');
  await waitFor(() => {
    expect(screen.queryByLabelText('Name')).toBeNull();
  });
}

describe('AC 5: folders', () => {
  it('creates a folder at the top level and one inside it, each at the end of its folder', async () => {
    const { ctx } = await setup();
    await openMenu();
    await screen.findByText('No bookmarks yet');
    await newFolder('Ports');
    await newFolder('Airfields');
    expect(names(stored(ctx))).toEqual(['Ports', 'Airfields']);

    fireEvent.click(await row('Ports')); // opens it: new things go in it
    press('New folder');
    expect(screen.getByText('In: Ports')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Quays' } });
    press('Create folder');
    await screen.findByRole('button', { name: 'Quays' });
    expect(names(children(stored(ctx), 'Ports'))).toEqual(['Quays']);
    expect(names(stored(ctx))).toEqual(['Ports', 'Airfields']);
  });

  it('refuses an empty folder name and creates nothing', async () => {
    const { ctx } = await setup();
    await openMenu();
    await screen.findByText('No bookmarks yet');
    press('New folder');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } });
    press('Create folder');
    expect(await screen.findByText('A name has 1 to 100 characters.')).toBeDefined();
    expect(stored(ctx)).toEqual([]);
  });

  it('goes five levels deep, and then switches New folder off and says why', async () => {
    const { ctx } = await setup();
    await seed(ctx, [folder('f1', 'L1', [folder('f2', 'L2', [folder('f3', 'L3', [folder('f4', 'L4')])])])]);
    await openMenu();
    for (const level of ['L1', 'L2', 'L3', 'L4']) fireEvent.click(await row(level));
    // L4 is open: a folder in it is level 5, which is allowed
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New folder' }).disabled).toBe(false);
    await newFolder('L5');
    fireEvent.click(await row('L5'));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New folder' }).disabled).toBe(true);
    expect(screen.getByText('Folders go 5 levels deep, and this one is on level 5')).toBeDefined();
    // a bookmark may still go there
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add bookmark' }).disabled).toBe(false);
  });

  it('renames a bookmark and a folder, and keeps them where they are', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home'), folder('f', 'Ports', [bookmark('b', 'Old')])]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Home'));
    press('Rename');
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Home');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Harbour  ' } });
    press('Rename');
    await row('Harbour');
    expect(names(stored(ctx))).toEqual(['Harbour', 'Ports']);

    fireEvent.click(await row('Ports'));
    press('Rename');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Docks' } });
    press('Rename');
    await row('Docks');
    expect(names(stored(ctx))).toEqual(['Harbour', 'Docks']);
    expect(names(children(stored(ctx), 'Docks'))).toEqual(['Old']);
  });

  it('refuses an empty new name and keeps the old one', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home')]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Home'));
    press('Rename');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    press('Rename');
    expect(await screen.findByText('A name has 1 to 100 characters.')).toBeDefined();
    expect(names(stored(ctx))).toEqual(['Home']);
  });

  it('deletes one bookmark without asking', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home'), bookmark('b', 'Away')]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Home'));
    press('Delete');
    await waitFor(() => {
      expect(names(stored(ctx))).toEqual(['Away']);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Choose a bookmark or a folder')).toBeDefined();
  });

  it('deletes an empty folder without asking', async () => {
    const { ctx } = await setup();
    await seed(ctx, [folder('f', 'Empty'), bookmark('a', 'Home')]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Empty'));
    press('Delete');
    await waitFor(() => {
      expect(names(stored(ctx))).toEqual(['Home']);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before deleting a folder that holds anything, states the counts, and deletes only when confirmed', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home'), folder('f', 'Ports', [bookmark('b', 'One'), folder('g', 'Quays', [bookmark('c', 'Two')])])]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Ports'));
    press('Delete');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete folder “Ports”?')).toBeDefined();
    expect(within(dialog).getByText('This also deletes 2 bookmarks and 1 folder.')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(names(stored(ctx))).toEqual(['Home', 'Ports']);

    press('Delete');
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(names(stored(ctx))).toEqual(['Home']);
    });
  });

  it('says "1 bookmark", not "1 bookmarks", for a folder with one', async () => {
    const { ctx } = await setup();
    await seed(ctx, [folder('f', 'Ports', [bookmark('b', 'One')])]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Ports'));
    press('Delete');
    expect(await screen.findByText('This also deletes 1 bookmark.')).toBeDefined();
  });
});

describe('AC 6: Move to…', () => {
  const base = (): TreeItem[] => [bookmark('a', 'A'), bookmark('b', 'B'), bookmark('c', 'C'), folder('f', 'Ports', [bookmark('x', 'X')])];

  it('moves an item to the end of a folder and back to the top level, the others keeping their order', async () => {
    const { ctx } = await setup();
    await seed(ctx, base());
    await openMenu();
    await edit();
    fireEvent.click(await row('B'));
    press('Move to…');
    expect(screen.getByText('Move “B” to:')).toBeDefined();
    // the top level is where B is, so only the folder is offered
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Ports']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ports' }));
    await waitFor(() => {
      expect(names(stored(ctx))).toEqual(['A', 'C', 'Ports']);
    });
    expect(names(children(stored(ctx), 'Ports'))).toEqual(['X', 'B']);

    fireEvent.click(await row('Ports')); // opens it
    fireEvent.click(await row('B'));
    press('Move to…');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Top level']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Top level' }));
    await waitFor(() => {
      expect(names(stored(ctx))).toEqual(['A', 'C', 'Ports', 'B']);
    });
    expect(names(children(stored(ctx), 'Ports'))).toEqual(['X']);
  });

  it('lists nested folders by their path, and not a folder or the folders in it for the folder itself', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'A'), folder('f', 'Ports', [folder('g', 'Quays')]), folder('h', 'Airfields')]);
    await openMenu();
    await edit();
    fireEvent.click(await row('A'));
    press('Move to…');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Ports', 'Ports / Quays', 'Airfields']);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(await row('Ports'));
    press('Move to…');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Airfields']);
  });

  it('says so when there is nowhere else to move the item', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'A')]);
    await openMenu();
    await edit();
    fireEvent.click(await row('A'));
    press('Move to…');
    expect(screen.getByText('There is nowhere else to move it.')).toBeDefined();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('does not offer a folder that would put another one deeper than five levels', async () => {
    const { ctx } = await setup();
    await seed(ctx, [
      folder('f1', 'L1', [folder('f2', 'L2', [folder('f3', 'L3', [folder('f4', 'L4')])])]),
      folder('g', 'G', [folder('h', 'H')]), // G with H inside is two levels
    ]);
    await openMenu();
    await edit();
    fireEvent.click(await row('G'));
    press('Move to…');
    const offered = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(offered).toContain('L1 / L2 / L3'); // G at level 4, H at level 5
    expect(offered).not.toContain('L1 / L2 / L3 / L4'); // H would be at level 6
  });
});

describe('edit mode', () => {
  it('selects a bookmark instead of going to it, and goes to it again when edit mode is off', async () => {
    const { ctx, map } = await setup();
    await seed(ctx, [bookmark('a', 'Home')]);
    await openMenu();
    const pencil = await screen.findByRole('button', { name: 'Edit bookmarks' });
    expect(pencil.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pencil);
    expect(pencil.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(await row('Home'));
    expect(map.goToCalls).toEqual([]);
    expect(screen.getByText('Selected: Home')).toBeDefined();
    expect(screen.queryByRole('dialog')).not.toBeNull();

    fireEvent.click(pencil);
    expect(screen.queryByText('Selected: Home')).toBeNull();
    fireEvent.click(await row('Home'));
    expect(map.goToCalls).toHaveLength(1);
  });

  it('has Rename, Move to… and Delete off until something is selected', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home')]);
    await openMenu();
    await edit();
    for (const name of ['Rename', 'Move to…', 'Delete']) expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    fireEvent.click(await row('Home'));
    for (const name of ['Rename', 'Move to…', 'Delete']) expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(false);
  });

  it('is off again when the menu is opened the next time', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home')]);
    await openMenu();
    await edit();
    fireEvent.click(trigger()); // closes
    await openMenu();
    expect((await screen.findByRole('button', { name: 'Edit bookmarks' })).getAttribute('aria-pressed')).toBe('false');
  });

  it('says that the item is gone, and shows the newest tree, when it was removed in another browser', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home'), bookmark('b', 'Away')]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Home'));
    await ctx.userDocuments.put(DOCUMENT_NAME, serialize({ items: [bookmark('b', 'Away')] })); // the other browser
    press('Rename');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Harbour' } });
    press('Rename');
    expect(await screen.findByText(/is gone; it was probably removed in another browser/)).toBeDefined();
    press('Cancel'); // back to the list, which has been read again
    expect(await row('Away')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(names(stored(ctx))).toEqual(['Away']);
  });
});

describe('AC 7 and AC 11: the limit and the keyboard', () => {
  it('switches New folder off at the limit, with the reason, as Add bookmark', async () => {
    const { ctx } = await setup({ maxItems: 2 });
    await seed(ctx, [bookmark('a', 'A'), folder('f', 'F')]);
    await openMenu();
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New folder' }).disabled).toBe(true);
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add bookmark' }).disabled).toBe(true);
    // the reason is said once, not for each button
    expect(screen.getAllByText('The limit of 2 bookmarks and folders is reached')).toHaveLength(1);
  });

  it('leaves a form, a choice or a rename on Escape and keeps the menu open', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'A'), folder('f', 'F')]);
    await openMenu();
    press('New folder');
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(screen.queryByLabelText('Name')).toBeNull();

    await edit();
    fireEvent.click(await row('A'));
    press('Move to…');
    const choice = screen.getByRole('menuitem', { name: 'F' });
    fireEvent.keyDown(choice, { key: 'Escape' });
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeNull();

    press('Rename');
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('keeps the focus in the menu through the folder form, so Escape works without Tab', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'A')]);
    const dialog = await openMenu();
    await screen.findByRole('button', { name: 'A' });
    press('New folder');
    await waitFor(() => {
      expect(globalThis.document.activeElement).toBe(screen.getByLabelText('Name'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(dialog.contains(globalThis.document.activeElement)).toBe(true);
    });
  });
});

describe('after a delete', () => {
  it('keeps the focus in the menu after a confirmed delete, a cancelled one and an unasked one, so Escape still works', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home'), bookmark('c', 'Away'), folder('f', 'Ports', [bookmark('b', 'One')])]);
    const dialog = await openMenu();
    await edit();
    const inMenu = () => dialog.contains(globalThis.document.activeElement);

    fireEvent.click(await row('Ports'));
    press('Delete');
    const question = await screen.findByRole('alertdialog');
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(inMenu()).toBe(true);
    });

    press('Delete');
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(names(stored(ctx))).toEqual(['Home', 'Away']);
    });
    expect(inMenu()).toBe(true);

    fireEvent.click(await row('Home'));
    press('Delete'); // a bookmark: no question
    await waitFor(() => {
      expect(names(stored(ctx))).toEqual(['Away']);
    });
    expect(inMenu()).toBe(true);
    const focused = globalThis.document.activeElement;
    if (!focused) throw new Error('nothing has the focus');
    fireEvent.keyDown(focused, { key: 'Escape' });
    expect(dialog.isConnected).toBe(false);
  });

  it('counts only folders when a folder holds only folders', async () => {
    const { ctx } = await setup();
    await seed(ctx, [folder('f', 'Ports', [folder('g', 'Quays')])]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Ports'));
    press('Delete');
    expect(await screen.findByText('This also deletes 1 folder.')).toBeDefined();
  });

  it('asks with the counts of the newest tree, when another browser has added to the folder meanwhile', async () => {
    const { ctx } = await setup();
    await seed(ctx, [folder('f', 'Ports')]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Ports'));
    // the other browser puts two bookmarks in it
    await seed(ctx, [folder('f', 'Ports', [bookmark('x', 'X'), bookmark('y', 'Y')])]);
    press('Delete');
    expect(await screen.findByText('This also deletes 2 bookmarks.')).toBeDefined();
    expect(names(children(stored(ctx), 'Ports'))).toEqual(['X', 'Y']); // nothing deleted yet
  });

  it('puts new things at the top level again when the open folder is deleted', async () => {
    const { ctx } = await setup();
    await seed(ctx, [folder('f', 'Ports')]);
    await openMenu();
    await edit();
    fireEvent.click(await row('Ports')); // open, selected
    press('Delete'); // empty: no question
    await waitFor(() => {
      expect(stored(ctx)).toEqual([]);
    });
    press('New folder');
    expect(screen.getByText('In: top level')).toBeDefined();
  });

  it('announces the selection', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home')]);
    await openMenu();
    await edit();
    expect(screen.getByRole('group', { name: 'Edit the selected row' })).toBeDefined();
    fireEvent.click(await row('Home'));
    expect(screen.getByRole('status').textContent).toBe('Selected: Home');
  });
});

describe('the name field when a form opens', () => {
  it('has the proposed or old name selected, so that typing replaces it', async () => {
    const { ctx } = await setup();
    await seed(ctx, [bookmark('a', 'Home')]);
    await openMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
    await waitFor(() => {
      const input = screen.getByLabelText<HTMLInputElement>('Name');
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    });
    expect(screen.getByLabelText<HTMLInputElement>('Name').value.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await edit();
    fireEvent.click(await row('Home'));
    press('Rename');
    await waitFor(() => {
      const input = screen.getByLabelText<HTMLInputElement>('Name');
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
    });
  });
});
