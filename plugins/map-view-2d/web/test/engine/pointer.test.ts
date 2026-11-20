/** The viewport's pointer routing (MCA review B1): a grab follows the pointer outside the map. */
import { afterEach, describe, expect, it } from 'vitest';
import type { EnginePointerEvent } from '../../src/core/engine.ts';
import { PointerRouter } from '../../src/engine/pointer.ts';

afterEach(() => {
  document.body.replaceChildren();
});

function pointer(type: string, x: number, y = 10, keys: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}): MouseEvent {
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, ...keys };
  const event = typeof PointerEvent === 'function' ? new PointerEvent(type, { ...init, pointerId: 7 }) : new MouseEvent(type, init);
  if (!('pointerId' in event)) Object.defineProperty(event, 'pointerId', { value: 7 });
  return event;
}

function setup(claim: (x: number) => boolean) {
  const viewport = document.createElement('div');
  const outside = document.createElement('div');
  document.body.append(viewport, outside);
  const events: EnginePointerEvent[] = [];
  const router = new PointerRouter(viewport, (e) => [e.clientX, e.clientY], (e) => events.push(e));
  router.setGrabTest(([x]) => claim(x));
  return { viewport, outside, events, router, types: () => events.map((e) => e.type) };
}

describe('pointer routing', () => {
  it('a release outside the map ends a grab', () => {
    const { viewport, outside, types, router } = setup((x) => x < 50);
    viewport.dispatchEvent(pointer('pointerdown', 10));
    expect(router.grabbing).toBe(true);
    outside.dispatchEvent(pointer('pointermove', 400));
    outside.dispatchEvent(pointer('pointerup', 500));
    expect(types()).toEqual(['down', 'move', 'up']);
    expect(router.grabbing).toBe(false);
    outside.dispatchEvent(pointer('pointerup', 500)); // no longer followed
    expect(types()).toHaveLength(3);
  });

  it('a press with the right button is never a grab, also on the object: it is the menu (brief function 15)', () => {
    const { viewport, router } = setup(() => true);
    const right = pointer('pointerdown', 10);
    Object.defineProperty(right, 'button', { value: 2 });
    viewport.dispatchEvent(right);
    expect(router.grabbing).toBe(false);
  });

  it('a press with Ctrl, Cmd or Shift is never a grab, also on the object: it is a box (brief function 14)', () => {
    const { viewport, router } = setup(() => true);
    for (const keys of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      viewport.dispatchEvent(pointer('pointerdown', 10, 10, keys));
      expect(router.grabbing).toBe(false);
    }
    viewport.dispatchEvent(pointer('pointerdown', 10));
    expect(router.grabbing).toBe(true);
  });

  it('reports a release on the map once', () => {
    const { viewport, types } = setup(() => true);
    viewport.dispatchEvent(pointer('pointerdown', 10));
    viewport.dispatchEvent(pointer('pointerup', 20));
    expect(types()).toEqual(['down', 'up']);
  });

  it('leaves a press it does not claim to the map (panning): no grab, nothing followed outside', () => {
    const { viewport, outside, types, router } = setup((x) => x < 50);
    expect(router.claims([100, 10])).toBe(false);
    viewport.dispatchEvent(pointer('pointerdown', 100));
    expect(router.grabbing).toBe(false);
    outside.dispatchEvent(pointer('pointerup', 500));
    viewport.dispatchEvent(pointer('pointerup', 120));
    expect(types()).toEqual(['down', 'up']);
  });

  it('reports a cancelled pointer and ends the grab', () => {
    const { viewport, outside, types, router } = setup(() => true);
    viewport.dispatchEvent(pointer('pointerdown', 10));
    outside.dispatchEvent(pointer('pointercancel', 10));
    expect(types()).toEqual(['down', 'cancel']);
    expect(router.grabbing).toBe(false);
  });

  it('ends a grab when the grab test is cleared (the interaction ended)', () => {
    const { viewport, outside, types, router } = setup(() => true);
    viewport.dispatchEvent(pointer('pointerdown', 10));
    router.setGrabTest(null);
    expect(router.grabbing).toBe(false);
    expect(router.claims([10, 10])).toBe(false);
    outside.dispatchEvent(pointer('pointerup', 500));
    expect(types()).toEqual(['down']);
  });

  it('cancelGrab ends a grab from outside: reported as cancelled, nothing followed afterwards (review remark N6)', () => {
    const { viewport, outside, events, types, router } = setup(() => true);
    viewport.dispatchEvent(pointer('pointerdown', 10));
    outside.dispatchEvent(pointer('pointermove', 300));
    router.cancelGrab();
    expect(router.grabbing).toBe(false);
    expect(types()).toEqual(['down', 'move', 'cancel']);
    expect(events[2]?.pixel).toEqual([300, 10]); // where the pointer was last seen
    outside.dispatchEvent(pointer('pointermove', 400));
    outside.dispatchEvent(pointer('pointerup', 500));
    expect(types()).toHaveLength(3);
  });

  it('cancelGrab without a grab does nothing', () => {
    const { types, router } = setup(() => true);
    router.cancelGrab();
    expect(types()).toEqual([]);
  });
});
