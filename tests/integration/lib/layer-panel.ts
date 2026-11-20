import { expect, type Locator, type Page } from '@playwright/test';

// The layer panel's "New layer" (layer-panel function 23, T-171; SDK 1.5.0 part 4): "New layer" and
// "Create first layer" open the SDK's ConfirmDialog "New layer" with a "Name" (function 5's
// "Layer N") and, with an order for the default policy, a "Classification"; "Create" sends the
// layer, Cancel and Escape send nothing.

/** The Control Pane's Layers panel. */
export function layersPanel(page: Page): Locator {
  return page.getByRole('tabpanel', { name: 'Layers', exact: true });
}

/** The panel's "New layer" or "Create first layer" button. */
export function newLayerButton(page: Page): Locator {
  return layersPanel(page).getByRole('button', { name: /^(New layer|Create first layer)$/ });
}

/** The "New layer" dialog. */
export function newLayerDialog(page: Page): Locator {
  return page.getByRole('alertdialog', { name: 'New layer', exact: true });
}

/** Clicks "New layer" (or "Create first layer") and waits for its dialog; answers its parts. */
export async function openNewLayer(page: Page) {
  await newLayerButton(page).click();
  const dialog = newLayerDialog(page);
  await expect(dialog).toBeVisible();
  return {
    dialog,
    name: dialog.getByRole('textbox', { name: 'Name', exact: true }),
    classification: dialog.getByRole('combobox', { name: 'Classification', exact: true }),
    create: dialog.getByRole('button', { name: 'Create', exact: true }),
    cancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
  };
}

/**
 * Makes a layer as a user does from the panel: "New layer", the name and classification if given
 * (else the dialog's own), "Create"; waits until the dialog has closed. Answers the name sent.
 */
export async function newLayer(page: Page, options: { name?: string; classification?: string } = {}): Promise<string> {
  const parts = await openNewLayer(page);
  if (options.name !== undefined) await parts.name.fill(options.name);
  if (options.classification !== undefined) await parts.classification.selectOption(options.classification);
  const name = (await parts.name.inputValue()).trim();
  await parts.create.click();
  await expect(parts.dialog).toBeHidden();
  return name;
}
