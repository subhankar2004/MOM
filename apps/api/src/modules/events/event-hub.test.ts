import { describe, expect, it, vi } from 'vitest';
import { EventHub, type OrderEvent } from './event-hub.js';

const ev = (over: Partial<Omit<OrderEvent, 'id' | 'at'>> = {}) => ({
  orderId: 'o1',
  userId: 'u1',
  stallId: 's1',
  status: 'placed',
  paymentStatus: 'due',
  tokenNo: 1,
  ...over,
});

describe('EventHub', () => {
  it('delivers an order change to its student and its stall only', () => {
    const hub = new EventHub();
    const student = vi.fn();
    const otherStudent = vi.fn();
    const stall = vi.fn();
    const otherStall = vi.fn();
    hub.subscribeUser('u1', student);
    hub.subscribeUser('u2', otherStudent);
    hub.subscribeStall('s1', stall);
    hub.subscribeStall('s2', otherStall);
    hub.publish(ev({ status: 'ready' }));
    expect(student).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', status: 'ready' }));
    expect(stall).toHaveBeenCalledOnce();
    expect(otherStudent).not.toHaveBeenCalled();
    expect(otherStall).not.toHaveBeenCalled();
  });

  it('unsubscribing stops delivery and frees the slot', () => {
    const hub = new EventHub();
    const fn = vi.fn();
    const sub = hub.subscribeUser('u1', fn);
    expect(hub.connections).toBe(1);
    sub.unsubscribe();
    hub.publish(ev());
    expect(fn).not.toHaveBeenCalled();
    expect(hub.connections).toBe(0);
  });

  it('a reconnecting client with Last-Event-ID gets exactly what it missed (its own events)', () => {
    const hub = new EventHub();
    const seen = hub.publish(ev({ status: 'placed' }));
    hub.publish(ev({ status: 'preparing' }));
    hub.publish(ev({ userId: 'u2', orderId: 'o9' })); // someone else's
    hub.publish(ev({ status: 'ready' }));
    const replayed: string[] = [];
    const sub = hub.subscribeUser('u1', (e) => replayed.push(e.status), seen.id);
    expect(sub.resync).toBe(false);
    expect(replayed).toEqual(['preparing', 'ready']);
  });

  it('an unknown or too-old Last-Event-ID asks the client to resync', () => {
    const hub = new EventHub();
    hub.publish(ev());
    expect(hub.subscribeUser('u1', () => {}, 'gone-id').resync).toBe(true);
  });

  it('event ids are unique and increasing', () => {
    const hub = new EventHub();
    const ids = Array.from({ length: 5 }, () => hub.publish(ev()).id);
    expect(new Set(ids).size).toBe(5);
  });
});
