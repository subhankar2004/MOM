'use client';

import { formatINR } from '@mom/shared';
import { ArrowDown, ArrowUp, ImageOff, Pencil, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { useToast } from '@/components/ui/toast';
import { VegDot } from '@/components/ui/veg-dot';
import { DishFormSheet, type DishDraft } from '@/components/vendor/dish-form-sheet';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { useCurrentStall } from '@/lib/vendor-stall';
import {
  menuApi,
  moved,
  useEditorMenu,
  useMenuMutation,
  type EditorCategory,
  type EditorItem,
  type ItemFields,
} from '@/lib/vendor-menu';

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'That didn’t save. Check your connection and try again.';

/** The menu editor (spec §6.2 V5). Owners only: counter staff see a note instead. */
export function MenuEditor() {
  const { current: stall } = useCurrentStall();
  if (stall.memberRole === 'staff') {
    return (
      <EmptyState
        as="h1"
        icon={<UtensilsCrossed size={36} aria-hidden />}
        title="Menu"
        description="Only the stall owner can change dishes and prices. Ask them to mark items sold out."
      />
    );
  }
  return <Editor stallId={stall.id} />;
}

function Editor({ stallId }: { stallId: string }) {
  const menu = useEditorMenu(stallId);
  const toast = useToast();
  const [categorySheet, setCategorySheet] = useState<{ category: EditorCategory | null } | null>(null);
  const [dish, setDish] = useState<DishDraft | null>(null);

  const fail = (err: unknown) => toast(errorText(err), 'error');

  const saveCategory = useMenuMutation(stallId, (input: { id?: string; name: string }) =>
    input.id
      ? menuApi.renameCategory(stallId, input.id, input.name)
      : menuApi.addCategory(stallId, input.name),
  );
  const deleteCategory = useMenuMutation(
    stallId,
    (id: string) => menuApi.deleteCategory(stallId, id),
    (cats, id) => cats.filter((c) => c.id !== id),
  );
  const reorderCategories = useMenuMutation(
    stallId,
    (ids: string[]) => menuApi.reorderCategories(stallId, ids),
    (cats, ids) => ids.map((id) => cats.find((c) => c.id === id)!).filter(Boolean),
  );
  const reorderItems = useMenuMutation(
    stallId,
    (input: { categoryId: string; ids: string[] }) =>
      menuApi.reorderItems(stallId, input.categoryId, input.ids),
    (cats, { categoryId, ids }) =>
      cats.map((c) =>
        c.id === categoryId ? { ...c, items: ids.map((id) => c.items.find((i) => i.id === id)!) } : c,
      ),
  );
  const setAvailable = useMenuMutation(
    stallId,
    (input: { available: boolean; itemIds?: string[] }) =>
      menuApi.setAvailability(stallId, input.available, input.itemIds),
    (cats, { available, itemIds }) =>
      cats.map((c) => ({
        ...c,
        items: c.items.map((i) =>
          !itemIds || itemIds.includes(i.id) ? { ...i, isAvailable: available } : i,
        ),
      })),
  );
  const saveDish = useMenuMutation(stallId, (input: { id?: string; fields: ItemFields }) =>
    input.id ? menuApi.updateItem(stallId, input.id, input.fields) : menuApi.addItem(stallId, input.fields),
  );
  const deleteDish = useMenuMutation(
    stallId,
    (id: string) => menuApi.deleteItem(stallId, id),
    (cats, id) => cats.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== id) })),
  );

  if (menu.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (menu.isError) {
    return (
      <EmptyState
        as="h1"
        title="Can't load your menu"
        description="Check your internet connection, then try again."
        action={<Button onClick={() => menu.refetch()}>Try again</Button>}
      />
    );
  }

  const categories = menu.data;
  const dishCount = categories.reduce((n, c) => n + c.items.length, 0);
  const soldOut = categories.flatMap((c) => c.items).filter((i) => !i.isAvailable).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Menu</h1>
          <p className="text-ink-muted">
            {dishCount === 1 ? '1 dish' : `${dishCount} dishes`}
            {soldOut > 0 && `, ${soldOut} sold out`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {soldOut > 0 && (
            <Button
              variant="secondary"
              loading={setAvailable.isPending && !setAvailable.variables?.itemIds}
              onClick={() =>
                setAvailable.mutate(
                  { available: true },
                  { onSuccess: () => toast('Every dish is available again', 'success'), onError: fail },
                )
              }
            >
              Mark all available
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<Plus size={18} aria-hidden />}
            onClick={() => setCategorySheet({ category: null })}
          >
            Add category
          </Button>
        </div>
      </header>

      {categories.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed size={36} aria-hidden />}
          title="Start your menu"
          description="Add a category like “Dosa” or “Drinks”, then add dishes to it."
          action={<Button onClick={() => setCategorySheet({ category: null })}>Add a category</Button>}
        />
      ) : (
        categories.map((category, index) => (
          <CategorySection
            key={category.id}
            category={category}
            first={index === 0}
            last={index === categories.length - 1}
            onMove={(delta) =>
              reorderCategories.mutate(
                moved(categories, index, delta).map((c) => c.id),
                { onError: fail },
              )
            }
            onRename={() => setCategorySheet({ category })}
            onDelete={() =>
              deleteCategory.mutate(category.id, {
                onSuccess: () => toast(`“${category.name}” deleted`, 'success'),
                onError: fail,
              })
            }
            onAddDish={() => setDish({ item: null, categoryId: category.id })}
            onEditDish={(item) => setDish({ item, categoryId: category.id })}
            onMoveDish={(itemIndex, delta) =>
              reorderItems.mutate(
                { categoryId: category.id, ids: moved(category.items, itemIndex, delta).map((i) => i.id) },
                { onError: fail },
              )
            }
            onToggle={(item) =>
              setAvailable.mutate(
                { available: !item.isAvailable, itemIds: [item.id] },
                {
                  onSuccess: () =>
                    toast(
                      item.isAvailable ? `${item.name} is sold out` : `${item.name} is available`,
                      'success',
                    ),
                  onError: fail,
                },
              )
            }
          />
        ))
      )}

      <CategorySheet
        state={categorySheet}
        saving={saveCategory.isPending}
        onClose={() => setCategorySheet(null)}
        onSave={(name) =>
          saveCategory.mutate(
            { id: categorySheet?.category?.id, name },
            {
              onSuccess: () => {
                setCategorySheet(null);
                toast(categorySheet?.category ? 'Category renamed' : `“${name}” added`, 'success');
              },
              onError: fail,
            },
          )
        }
      />

      <DishFormSheet
        draft={dish}
        stallId={stallId}
        categories={categories}
        onClose={() => setDish(null)}
        saving={saveDish.isPending}
        onSave={(fields) =>
          saveDish.mutate(
            { id: dish?.item?.id, fields },
            {
              onSuccess: () => {
                setDish(null);
                toast(dish?.item ? 'Changes saved' : `${fields.name} added`, 'success');
              },
              onError: fail,
            },
          )
        }
        deleting={deleteDish.isPending}
        onDelete={(item) =>
          deleteDish.mutate(item.id, {
            onSuccess: () => {
              setDish(null);
              toast(`${item.name} deleted`, 'success');
            },
            onError: fail,
          })
        }
      />
    </div>
  );
}

function CategorySection({
  category,
  first,
  last,
  onMove,
  onRename,
  onDelete,
  onAddDish,
  onEditDish,
  onMoveDish,
  onToggle,
}: {
  category: EditorCategory;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
  onRename: () => void;
  onDelete: () => void;
  onAddDish: () => void;
  onEditDish: (item: EditorItem) => void;
  onMoveDish: (index: number, delta: -1 | 1) => void;
  onToggle: (item: EditorItem) => void;
}) {
  const headingId = `cat-${category.id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-(--radius-card) border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-1 border-b border-border py-1 pr-1 pl-4">
        <h2 id={headingId} className="mr-auto font-display text-xl font-bold">
          {category.name}
        </h2>
        <IconButton
          label={`Move ${category.name} up`}
          icon={<ArrowUp size={18} aria-hidden />}
          disabled={first}
          onClick={() => onMove(-1)}
        />
        <IconButton
          label={`Move ${category.name} down`}
          icon={<ArrowDown size={18} aria-hidden />}
          disabled={last}
          onClick={() => onMove(1)}
        />
        <IconButton
          label={`Rename ${category.name}`}
          icon={<Pencil size={18} aria-hidden />}
          onClick={onRename}
        />
        {category.items.length === 0 && (
          <IconButton
            label={`Delete ${category.name}`}
            icon={<Trash2 size={18} aria-hidden />}
            onClick={onDelete}
          />
        )}
      </div>

      {category.items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-muted">No dishes yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {category.items.map((item, index) => (
            <DishRow
              key={item.id}
              item={item}
              first={index === 0}
              last={index === category.items.length - 1}
              onEdit={() => onEditDish(item)}
              onMove={(delta) => onMoveDish(index, delta)}
              onToggle={() => onToggle(item)}
            />
          ))}
        </ul>
      )}
      <div className="border-t border-border p-2">
        <Button variant="ghost" icon={<Plus size={18} aria-hidden />} onClick={onAddDish}>
          Add dish to {category.name}
        </Button>
      </div>
    </section>
  );
}

function DishRow({
  item,
  first,
  last,
  onEdit,
  onMove,
  onToggle,
}: {
  item: EditorItem;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMove: (delta: -1 | 1) => void;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2 pr-1 pl-3" aria-label={item.name}>
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-(--radius-control) text-left"
      >
        <span
          className={cn(
            'relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-(--radius-control) bg-surface-2',
            !item.isAvailable && 'grayscale',
          )}
        >
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <ImageOff size={20} aria-hidden className="text-ink-muted" />
          )}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <VegDot veg={item.isVeg} size={14} />
            <span className="truncate font-semibold">{item.name}</span>
          </span>
          <span className="tabular text-sm text-ink-muted">
            {formatINR(item.pricePaise, { compact: true })}
            {!item.isAvailable && ' · Sold out'}
          </span>
        </span>
        <span className="sr-only">Edit</span>
      </button>
      <AvailabilitySwitch name={item.name} on={item.isAvailable} onToggle={onToggle} />
      <div className="hidden sm:flex">
        <IconButton
          label={`Move ${item.name} up`}
          icon={<ArrowUp size={16} aria-hidden />}
          disabled={first}
          onClick={() => onMove(-1)}
        />
        <IconButton
          label={`Move ${item.name} down`}
          icon={<ArrowDown size={16} aria-hidden />}
          disabled={last}
          onClick={() => onMove(1)}
        />
      </div>
    </li>
  );
}

/** A large on/off switch: the one control vendors use many times a day. */
function AvailabilitySwitch({ name, on, onToggle }: { name: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${name} available`}
      onClick={onToggle}
      className="flex min-h-11 shrink-0 items-center gap-2 rounded-full px-2"
    >
      <span
        aria-hidden
        className={cn('relative h-7 w-12 rounded-full transition-colors', on ? 'bg-veg' : 'bg-border')}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform',
            on && 'translate-x-5',
          )}
        />
      </span>
      <span className="w-16 text-left text-sm font-medium">{on ? 'On' : 'Sold out'}</span>
    </button>
  );
}

function CategorySheet({
  state,
  saving,
  onClose,
  onSave,
}: {
  state: { category: EditorCategory | null } | null;
  saving: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  return (
    <Sheet
      open={state !== null}
      onClose={onClose}
      title={state?.category ? 'Rename category' : 'Add a category'}
    >
      {state && (
        <CategoryForm
          key={state.category?.id ?? 'new'}
          initial={state.category?.name ?? ''}
          saving={saving}
          onSave={onSave}
        />
      )}
    </Sheet>
  );
}

function CategoryForm({
  initial,
  saving,
  onSave,
}: {
  initial: string;
  saving: boolean;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const error = submitted && !name.trim() ? 'Give the category a name' : undefined;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (name.trim()) onSave(name.trim());
      }}
    >
      <TextField
        label="Category name"
        hint="For example: Dosa, Rolls, Drinks"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        error={error}
        autoComplete="off"
      />
      <Button type="submit" size="lg" fullWidth loading={saving}>
        {initial ? 'Save' : 'Add category'}
      </Button>
    </form>
  );
}
