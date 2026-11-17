'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/** Height of the sticky header + this nav, so sections land just below them. */
export const MENU_SCROLL_OFFSET = 120;

/**
 * Sticky category chips (spec §6.1 S3). Tapping scrolls to the section; while scrolling,
 * the chip of the section in view is highlighted (aria-current) and kept visible.
 */
export function CategoryNav({ categories }: { categories: Array<{ id: string; name: string }> }) {
  const [active, setActive] = useState(categories[0]?.id);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sections = categories
      .map((c) => document.getElementById(`cat-${c.id}`))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id.slice(4));
      },
      // A thin band just under the sticky bars decides which section is "current".
      { rootMargin: `-${MENU_SCROLL_OFFSET}px 0px -65% 0px` },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [categories]);

  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>(`[data-cat="${active}"]`)
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [active]);

  function go(id: string) {
    setActive(id);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(`cat-${id}`)
      ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  return (
    <nav
      aria-label="Menu sections"
      className="sticky top-14 z-20 -mx-4 border-b border-border bg-bg/95 px-4 backdrop-blur"
    >
      <div ref={navRef} className="flex gap-2 overflow-x-auto py-2 [scrollbar-width:none]">
        {categories.map((c) => (
          <a
            key={c.id}
            href={`#cat-${c.id}`}
            data-cat={c.id}
            aria-current={active === c.id ? 'true' : undefined}
            onClick={(e) => {
              e.preventDefault();
              go(c.id);
            }}
            className={cn(
              'flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors',
              active === c.id
                ? 'border-brand bg-brand text-brand-ink'
                : 'border-border bg-surface text-ink hover:bg-surface-2',
            )}
          >
            {c.name}
          </a>
        ))}
      </div>
    </nav>
  );
}
