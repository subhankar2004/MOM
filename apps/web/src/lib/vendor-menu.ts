'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest } from './api-client';
import { compressImage } from './image-compress';

export interface EditorItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  isVeg: boolean;
  imageKey: string | null;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
}

export interface EditorCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: EditorItem[];
}

export interface ItemFields {
  categoryId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  isVeg: boolean;
  imageKey: string | null;
  isAvailable: boolean;
}

const base = (stallId: string) => `/v1/vendor/stalls/${encodeURIComponent(stallId)}` as const;
export const menuKey = (stallId: string) => ['vendor', 'menu', stallId] as const;

export function useEditorMenu(stallId: string) {
  return useQuery({
    queryKey: menuKey(stallId),
    queryFn: () => apiRequest<{ categories: EditorCategory[] }>(`${base(stallId)}/menu`),
    select: (data) => data.categories,
  });
}

/** Every menu change goes through here and reloads the menu afterwards. */
export function useMenuMutation<TInput, TResult = unknown>(
  stallId: string,
  run: (input: TInput) => Promise<TResult>,
  /** Instant change to the cached menu while the request is in flight. */
  optimistic?: (categories: EditorCategory[], input: TInput) => EditorCategory[],
) {
  const queryClient = useQueryClient();
  const key = menuKey(stallId);
  return useMutation({
    mutationFn: run,
    onMutate: async (input) => {
      if (!optimistic) return undefined;
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<{ categories: EditorCategory[] }>(key);
      if (before) queryClient.setQueryData(key, { categories: optimistic(before.categories, input) });
      return { before };
    },
    onError: (_err, _input, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export const menuApi = {
  addCategory: (stallId: string, name: string) =>
    apiRequest<{ category: EditorCategory }>(`${base(stallId)}/categories`, {
      method: 'POST',
      body: { name },
    }),
  renameCategory: (stallId: string, id: string, name: string) =>
    apiRequest(`${base(stallId)}/categories/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
  deleteCategory: (stallId: string, id: string) =>
    apiRequest(`${base(stallId)}/categories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorderCategories: (stallId: string, ids: string[]) =>
    apiRequest(`${base(stallId)}/categories/order`, { method: 'PUT', body: { ids } }),
  reorderItems: (stallId: string, categoryId: string, ids: string[]) =>
    apiRequest(`${base(stallId)}/categories/${encodeURIComponent(categoryId)}/items/order`, {
      method: 'PUT',
      body: { ids },
    }),
  addItem: (stallId: string, fields: ItemFields) =>
    apiRequest<{ item: EditorItem }>(`${base(stallId)}/items`, { method: 'POST', body: fields }),
  updateItem: (stallId: string, id: string, fields: Partial<ItemFields>) =>
    apiRequest<{ item: EditorItem }>(`${base(stallId)}/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: fields,
    }),
  deleteItem: (stallId: string, id: string) =>
    apiRequest(`${base(stallId)}/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setAvailability: (stallId: string, available: boolean, itemIds?: string[]) =>
    apiRequest<{ changed: number }>(`${base(stallId)}/items/availability`, {
      method: 'POST',
      body: { available, itemIds },
    }),
};

/**
 * Compresses a photo in the browser, then uploads it straight to storage with a short-lived
 * signed URL from the API. Returns the key to save on the dish (or, for `cover`, the stall).
 */
export async function uploadStallPhoto(
  stallId: string,
  file: Blob,
  purpose: 'item' | 'cover' = 'item',
): Promise<{ key: string; url: string }> {
  const { blob, type } = await compressImage(file);
  const signed = await apiRequest<{
    key: string;
    uploadUrl: string;
    headers: Record<string, string>;
    publicUrl: string;
  }>(`${base(stallId)}/uploads/presign`, {
    method: 'POST',
    body: { contentType: type, size: blob.size, purpose },
  });
  let res: Response;
  try {
    res = await fetch(signed.uploadUrl, { method: 'PUT', body: blob, headers: signed.headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', "The photo couldn't be uploaded. Check your internet connection.");
  }
  if (!res.ok) throw new ApiError(res.status, 'BAD_REQUEST', "The photo couldn't be uploaded. Try again.");
  return { key: signed.key, url: signed.publicUrl };
}

/** Moves the element at `index` by `delta` places (for the up/down buttons). */
export function moved<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}
