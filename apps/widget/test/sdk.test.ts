import { describe, expect, it } from 'vitest';

import { SupportEventEmitter } from '../src/sdk';

describe('Live Support SDK event lifecycle', () => {
  it('registers and removes listeners for SDK events', () => {
    const emitter = new SupportEventEmitter();
    const received: string[] = [];
    const callback = (): void => {
      received.push('open');
    };

    emitter.on('open', callback);
    emitter.emit('open', undefined);
    emitter.off('open', callback);
    emitter.emit('open', undefined);

    expect(received).toEqual(['open']);
  });

  it('returns an unsubscribe function and releases all listeners on clear', () => {
    const emitter = new SupportEventEmitter();
    const received: string[] = [];
    const unsubscribe = emitter.on('close', () => {
      received.push('close');
    });

    unsubscribe();
    emitter.emit('close', undefined);
    expect(received).toEqual([]);

    emitter.on('connected', () => {
      received.push('connected');
    });
    emitter.clear();
    emitter.emit('connected', 'connected');
    expect(received).toEqual([]);
  });

  it('supports independent event channels for repeated initialization', () => {
    const first = new SupportEventEmitter();
    const second = new SupportEventEmitter();
    let firstCount = 0;
    let secondCount = 0;

    first.on('message:sent', () => {
      firstCount += 1;
    });
    second.on('message:sent', () => {
      secondCount += 1;
    });

    first.emit('message:sent', { kind: 'text', content: 'hello' });
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(0);
  });
});
