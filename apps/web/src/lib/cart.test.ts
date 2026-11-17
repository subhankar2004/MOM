import { beforeEach, describe, expect, it } from 'vitest';
import { cartStore, MAX_QUANTITY, quantityIn } from './cart';

const dosa = { id: 's1', slug: 'dosa-corner', name: 'Dosa Corner' };
const chai = { id: 's2', slug: 'chai-and-rolls', name: 'Chai & Rolls' };
const masala = { itemId: 'i1', name: 'Masala Dosa', pricePaise: 6000 };
const idli = { itemId: 'i2', name: 'Idli', pricePaise: 3000 };

beforeEach(() => cartStore.clear());

describe('cart store', () => {
  it('adds, changes and removes items', () => {
    expect(cartStore.setQuantity(dosa, masala, 1)).toBe('ok');
    cartStore.setQuantity(dosa, idli, 2);
    cartStore.setQuantity(dosa, masala, 3);
    expect(cartStore.get().lines.map((l) => [l.name, l.quantity])).toEqual([
      ['Masala Dosa', 3],
      ['Idli', 2],
    ]);
    cartStore.setQuantity(dosa, masala, 0);
    expect(quantityIn(cartStore.get(), 'i1')).toBe(0);
    expect(cartStore.get().stall).toEqual(dosa);
  });

  it('forgets the stall once the cart is empty', () => {
    cartStore.setQuantity(dosa, masala, 1);
    cartStore.setQuantity(dosa, masala, 0);
    expect(cartStore.get()).toEqual({ stall: null, lines: [] });
  });

  it('one stall per cart: adding from another stall is refused until replaced', () => {
    cartStore.setQuantity(dosa, masala, 1);
    expect(cartStore.setQuantity(chai, { itemId: 'c1', name: 'Chai', pricePaise: 1500 }, 1)).toBe(
      'other-stall',
    );
    expect(cartStore.get().stall).toEqual(dosa);
    cartStore.replaceWith(chai, { itemId: 'c1', name: 'Chai', pricePaise: 1500 }, 1);
    expect(cartStore.get().stall).toEqual(chai);
    expect(cartStore.get().lines).toHaveLength(1);
  });

  it('keeps quantities between 0 and the maximum', () => {
    cartStore.setQuantity(dosa, masala, 99);
    expect(quantityIn(cartStore.get(), 'i1')).toBe(MAX_QUANTITY);
    cartStore.setQuantity(dosa, masala, -3);
    expect(quantityIn(cartStore.get(), 'i1')).toBe(0);
  });

  it('notifies subscribers', () => {
    let calls = 0;
    const off = cartStore.subscribe(() => calls++);
    cartStore.setQuantity(dosa, masala, 1);
    off();
    cartStore.setQuantity(dosa, masala, 2);
    expect(calls).toBe(1);
  });
});
