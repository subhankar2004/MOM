'use client';

import { paise } from '@mom/shared';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { TextField } from '@/components/ui/text-field';
import { VegDot } from '@/components/ui/veg-dot';
import { cn } from '@/lib/cn';
import { uploadStallPhoto, type EditorCategory, type EditorItem, type ItemFields } from '@/lib/vendor-menu';

export interface DishDraft {
  /** The dish being edited, or null for a new one. */
  item: EditorItem | null;
  categoryId: string;
}

function priceText(p: number) {
  return p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2);
}

function parsePrice(text: string): { value?: number; error?: string } {
  if (!text.trim()) return { error: 'Enter a price' };
  try {
    const value = paise(text.replace(/^₹\s*/, ''));
    if (value < 100) return { error: 'The price must be at least ₹1' };
    if (value > 1_000_000) return { error: 'The price must be ₹10,000 or less' };
    return { value };
  } catch {
    return { error: 'Enter the price in rupees, like 60 or 62.50' };
  }
}

/** Add or edit a dish: name, category, price, veg, description, photo and availability. */
export function DishFormSheet({
  draft,
  stallId,
  categories,
  onClose,
  onSave,
  saving,
  onDelete,
  deleting,
}: {
  draft: DishDraft | null;
  stallId: string;
  categories: EditorCategory[];
  onClose: () => void;
  onSave: (fields: ItemFields) => void;
  saving: boolean;
  onDelete: (item: EditorItem) => void;
  deleting: boolean;
}) {
  return (
    <Sheet open={draft !== null} onClose={onClose} title={draft?.item ? 'Edit dish' : 'Add a dish'}>
      {/* Remount per dish so the form starts from that dish's values. */}
      {draft && (
        <DishForm
          key={draft.item?.id ?? `new-${draft.categoryId}`}
          draft={draft}
          stallId={stallId}
          categories={categories}
          onSave={onSave}
          saving={saving}
        />
      )}
      {draft?.item && (
        <DeleteDish key={draft.item.id} onDelete={() => onDelete(draft.item!)} deleting={deleting} />
      )}
    </Sheet>
  );
}

function DishForm({
  draft,
  stallId,
  categories,
  onSave,
  saving,
}: {
  draft: DishDraft;
  stallId: string;
  categories: EditorCategory[];
  onSave: (fields: ItemFields) => void;
  saving: boolean;
}) {
  const item = draft.item;
  const [name, setName] = useState(item?.name ?? '');
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? draft.categoryId);
  const [price, setPrice] = useState(item ? priceText(item.pricePaise) : '');
  const [isVeg, setIsVeg] = useState(item?.isVeg ?? true);
  const [description, setDescription] = useState(item?.description ?? '');
  const [isAvailable, setIsAvailable] = useState(item?.isAvailable ?? true);
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(
    item?.imageKey && item.imageUrl ? { key: item.imageKey, url: item.imageUrl } : null,
  );
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = { category: useId(), description: useId(), photo: useId() };

  const parsed = parsePrice(price);
  const nameError = submitted && !name.trim() ? 'Give the dish a name' : undefined;
  const priceError = submitted ? parsed.error : undefined;

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setUploading(true);
    try {
      setPhoto(await uploadStallPhoto(stallId, file));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "The photo couldn't be uploaded.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!name.trim() || parsed.value === undefined || uploading) return;
        onSave({
          categoryId,
          name: name.trim(),
          description: description.trim() || null,
          pricePaise: parsed.value,
          isVeg,
          imageKey: photo?.key ?? null,
          isAvailable,
        });
      }}
    >
      {/* Photo first: it's what students look at. */}
      <div className="flex flex-col gap-1.5">
        <span id={ids.photo} className="text-sm font-semibold">
          Photo
        </span>
        <div className="flex items-center gap-3">
          <div className="relative size-24 shrink-0 overflow-hidden rounded-(--radius-control) border border-border bg-surface-2">
            {photo && (
              // Plain <img>: the preview is a fresh upload, not worth optimising.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.url} alt="Dish photo preview" className="size-full object-cover" />
            )}
            {!photo && !uploading && (
              <ImagePlus size={28} aria-hidden className="absolute inset-0 m-auto text-ink-muted" />
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface/70">
                <Spinner size={22} label="Uploading photo" />
              </div>
            )}
          </div>
          <div className="flex flex-col items-start gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              aria-labelledby={ids.photo}
              className="sr-only"
              onChange={(e) => void choosePhoto(e.target.files?.[0])}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {photo ? 'Replace photo' : 'Add photo'}
            </Button>
            {photo && (
              <Button
                variant="ghost"
                size="sm"
                disabled={uploading}
                icon={<Trash2 size={16} aria-hidden />}
                onClick={() => setPhoto(null)}
              >
                Remove photo
              </Button>
            )}
          </div>
        </div>
        {photoError ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {photoError}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">A square photo of the plate works best.</p>
        )}
      </div>

      <TextField
        label="Name"
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        error={nameError}
        autoComplete="off"
      />

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Price"
          leading="₹"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={priceError}
          autoComplete="off"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.category} className="text-sm font-semibold">
            Category
          </label>
          <select
            id={ids.category}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-12 rounded-(--radius-control) border border-border bg-surface px-3 text-base"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold">Type</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { veg: true, label: 'Veg' },
            { veg: false, label: 'Non-veg' },
          ].map((o) => (
            <label
              key={o.label}
              className={cn(
                'flex h-11 cursor-pointer items-center gap-2 rounded-(--radius-control) border px-3',
                isVeg === o.veg ? 'border-brand bg-surface-2 font-semibold' : 'border-border',
              )}
            >
              <input
                type="radio"
                name="veg"
                checked={isVeg === o.veg}
                onChange={() => setIsVeg(o.veg)}
                className="sr-only"
              />
              <VegDot veg={o.veg} />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.description} className="text-sm font-semibold">
          Description <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id={ids.description}
          value={description}
          maxLength={300}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-base"
        />
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={isAvailable}
          onChange={(e) => setIsAvailable(e.target.checked)}
          className="size-5 accent-(--brand)"
        />
        <span>Available to order now</span>
      </label>

      <Button type="submit" size="lg" fullWidth loading={saving} disabled={uploading}>
        {item ? 'Save changes' : 'Add dish'}
      </Button>
    </form>
  );
}

/** Two taps, so a stray tap on a tablet doesn't remove a dish. */
function DeleteDish({ onDelete, deleting }: { onDelete: () => void; deleting: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-6 border-t border-border pt-4">
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Students won&apos;t see this dish any more. Past orders keep it.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={deleting} onClick={onDelete}>
              Delete dish
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" icon={<Trash2 size={18} aria-hidden />} onClick={() => setConfirming(true)}>
          Delete this dish
        </Button>
      )}
    </div>
  );
}
