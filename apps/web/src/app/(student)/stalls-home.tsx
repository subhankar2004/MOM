'use client';

import { RefreshCw, Search, SearchX, Store, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { StallCard } from '@/components/food/stall-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { matchStall, useStalls } from '@/lib/stalls';
import { formatTime } from '@/lib/time';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold transition-colors',
        pressed
          ? 'border-brand bg-brand text-brand-ink'
          : 'border-border bg-surface text-ink hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}

function LoadingList() {
  return (
    <ul className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex gap-3 rounded-(--radius-card) border border-border bg-surface p-3">
          <Skeleton className="size-20" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The student home: every stall around campus, open ones first (spec §6.1 S2). */
export function StallsHome() {
  const stalls = useStalls();
  const [query, setQuery] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [vegOnly, setVegOnly] = useState(false);
  const { pull, ready, refreshing } = usePullToRefresh(() => stalls.refetch());

  // "Now" for opening-time labels advances with every refresh of the list.
  const now = useMemo(() => new Date(stalls.dataUpdatedAt || 0), [stalls.dataUpdatedAt]);

  const shown = useMemo(() => {
    return (stalls.data ?? [])
      .filter((s) => !openOnly || s.availability.state === 'open')
      .filter((s) => !vegOnly || s.isVegOnly)
      .map((s) => ({ stall: s, match: matchStall(s, query) }))
      .filter(({ match }) => match.matches);
  }, [stalls.data, query, openOnly, vegOnly]);

  const filtering = query.trim() !== '' || openOnly || vegOnly;
  const clearFilters = () => {
    setQuery('');
    setOpenOnly(false);
    setVegOnly(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Pull-to-refresh indicator (touch only) */}
      <div
        aria-hidden
        className="flex items-center justify-center overflow-hidden text-sm text-ink-muted transition-[height]"
        style={{ height: refreshing ? 32 : pull }}
      >
        {(pull > 0 || refreshing) && (
          <span className="flex items-center gap-2">
            {refreshing ? (
              <Spinner size={16} />
            ) : (
              <RefreshCw size={16} className={cn(ready && 'rotate-180')} />
            )}
            {refreshing ? 'Refreshing' : ready ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        )}
      </div>

      <h1 className="font-display text-3xl font-black">Stalls near you</h1>

      <div className="flex flex-col gap-3">
        <label className="flex h-12 items-center gap-2 rounded-(--radius-control) border border-border bg-surface px-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus">
          <Search size={18} aria-hidden className="shrink-0 text-ink-muted" />
          <span className="sr-only">Search stalls or dishes</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stalls or dishes"
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-muted"
          />
          {query && (
            <IconButton
              label="Clear search"
              icon={<X size={18} aria-hidden />}
              onClick={() => setQuery('')}
              className="size-9"
            />
          )}
        </label>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2" role="group" aria-label="Filters">
            <FilterChip pressed={openOnly} onClick={() => setOpenOnly((v) => !v)}>
              Open now
            </FilterChip>
            <FilterChip pressed={vegOnly} onClick={() => setVegOnly((v) => !v)}>
              Pure veg
            </FilterChip>
          </div>
          {stalls.isSuccess && (
            <span className="flex items-center text-xs whitespace-nowrap text-ink-muted">
              <span className="hidden min-[400px]:inline">Updated </span>
              {formatTime(new Date(stalls.dataUpdatedAt))}
              <IconButton
                label="Refresh stalls"
                icon={<RefreshCw size={16} aria-hidden className={cn(stalls.isFetching && 'animate-spin')} />}
                onClick={() => stalls.refetch()}
                className="size-9"
              />
            </span>
          )}
        </div>
      </div>

      {stalls.isPending && <LoadingList />}

      {stalls.isError && (
        <EmptyState
          title="Couldn't load the stalls"
          description={
            stalls.error instanceof ApiError
              ? stalls.error.message
              : 'Check your internet connection, then try again.'
          }
          action={
            <Button onClick={() => stalls.refetch()} loading={stalls.isFetching}>
              Try again
            </Button>
          }
        />
      )}

      {stalls.isSuccess && stalls.data.length === 0 && (
        <EmptyState
          icon={<Store size={36} aria-hidden />}
          title="No stalls yet"
          description="Stalls around campus will appear here as they join MOM."
        />
      )}

      {stalls.isSuccess && stalls.data.length > 0 && shown.length === 0 && (
        <EmptyState
          icon={<SearchX size={36} aria-hidden />}
          title={query.trim() ? `Nothing matches "${query.trim()}"` : 'No stalls match these filters'}
          description="Try another dish or stall name, or clear the filters."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear search and filters
            </Button>
          }
        />
      )}

      {shown.length > 0 && (
        <>
          <p className="sr-only" aria-live="polite">
            {filtering ? `${shown.length} stalls shown` : ''}
          </p>
          <ul aria-label="Stalls" className="flex flex-col gap-3">
            {shown.map(({ stall, match }) => (
              <li key={stall.id}>
                <StallCard stall={stall} now={now} matchedDishes={match.dishes} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
