import { beforeEach, describe, expect, it, vi } from 'vitest';

// tab-list.ts pulls in the whole app-state graph and grabs #tab-list at module
// load, so only the pure DOM wiring is exercised here: the fix for middle-click
// closing when the strip overflows is a single mousedown guard.
class FakeElement {
  innerHTML = '';
  private handlers: Record<string, Array<(e: unknown) => void>> = {};
  addEventListener(evt: string, fn: (e: unknown) => void) {
    (this.handlers[evt] ??= []).push(fn);
  }
  dispatch(evt: string, event: unknown) {
    for (const fn of this.handlers[evt] ?? []) fn(event);
  }
  querySelector() {
    return null;
  }
}

const els = new Map<string, FakeElement>();
vi.stubGlobal('document', {
  getElementById: (id: string) => {
    if (!els.has(id)) els.set(id, new FakeElement());
    return els.get(id)!;
  },
  createElement: () => new FakeElement(),
  addEventListener: () => {},
  body: new FakeElement(),
});
vi.stubGlobal('window', { rcode: { store: { load: vi.fn(), save: vi.fn() } } });

const { initMiddleClickClose } = await import('./tab-list.js');
const { tabListEl } = await import('./dom.js');

describe('initMiddleClickClose', () => {
  beforeEach(() => {
    els.clear();
  });

  function mouseDown(button: number) {
    const event = { button, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    (tabListEl as unknown as FakeElement).dispatch('mousedown', event);
    return event;
  }

  it('cancels a middle press so Chromium does not start auto-scroll', () => {
    initMiddleClickClose();
    const event = mouseDown(1);
    // Auto-scroll is this press's default action, and starting it swallows the
    // auxclick that closes the tab.
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves left and right presses alone', () => {
    initMiddleClickClose();
    expect(mouseDown(0).defaultPrevented).toBe(false);
    expect(mouseDown(2).defaultPrevented).toBe(false);
  });
});
