import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatWidgetHandle } from '../src/sdk-types';

const state = vi.hoisted(() => ({
  handle: undefined as ChatWidgetHandle | undefined,
  lastElement: undefined as { props?: { autoButton?: boolean } } | undefined,
  unmountCount: 0,
  removedCount: 0,
}));

vi.mock('../src/ChatWidget', () => ({ ChatWidget: 'MockChatWidget' }));
vi.mock('react-dom', () => ({
  flushSync(callback: () => void): void {
    callback();
  },
}));
vi.mock('react-dom/client', () => ({
  createRoot(): {
    render(element: {
      props?: { autoButton?: boolean };
      ref?: { current: ChatWidgetHandle | null };
    }): void;
    unmount(): void;
  } {
    return {
      render(element) {
        state.lastElement = element;
        if (element.ref !== undefined && state.handle !== undefined) {
          element.ref.current = state.handle;
        }
      },
      unmount() {
        state.unmountCount += 1;
      },
    };
  },
}));

import { LiveSupport } from '../src/sdk';

function installDocumentStub(): void {
  const container = {
    dataset: {} as Record<string, string>,
    remove: () => {
      state.removedCount += 1;
    },
  };
  const body = {
    appendChild: vi.fn(),
  };

  vi.stubGlobal('document', {
    body,
    documentElement: body,
    createElement: () => container,
  });
}

beforeEach(() => {
  state.handle = {
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    isOpen: vi.fn(() => false),
    setVisitor: vi.fn(),
    getVisitor: vi.fn(),
  };
  state.lastElement = undefined;
  state.unmountCount = 0;
  state.removedCount = 0;
  installDocumentStub();
});

describe('LiveSupport instance', () => {
  it('keeps the floating button enabled by default and supports autoButton=false', () => {
    LiveSupport.init();
    expect(state.lastElement?.props?.autoButton).toBe(true);

    LiveSupport.init({ autoButton: false });
    expect(state.lastElement?.props?.autoButton).toBe(false);
  });

  it('delegates open, close and toggle without changing the widget protocol', () => {
    const support = LiveSupport.init();
    const visitor = { name: '访客' };

    support.open();
    support.close();
    support.toggle();
    support.setVisitor(visitor);
    support.getVisitor();
    support.isOpen();

    expect(state.handle?.open).toHaveBeenCalledTimes(1);
    expect(state.handle?.close).toHaveBeenCalledTimes(1);
    expect(state.handle?.toggle).toHaveBeenCalledTimes(1);
    expect(state.handle?.setVisitor).toHaveBeenCalledWith(visitor);
    expect(state.handle?.getVisitor).toHaveBeenCalledTimes(1);
    expect(state.handle?.isOpen).toHaveBeenCalledTimes(1);
  });

  it('destroys the mounted root and makes repeated initialization independent', () => {
    const first = LiveSupport.init();
    const second = LiveSupport.init();

    first.destroy();
    expect(state.unmountCount).toBe(1);
    expect(state.removedCount).toBe(1);

    second.open();
    expect(state.handle?.open).toHaveBeenCalledTimes(1);
  });
});
