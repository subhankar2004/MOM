'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import type { PublicStall } from './stalls';

export interface HoursSlot {
  /** 1 = Monday … 7 = Sunday */
  weekday: number;
  /** "HH:MM", 24-hour, India time */
  opensAt: string;
  closesAt: string;
}

export interface StallSettings {
  settings: {
    name: string;
    status: 'draft' | 'active' | 'suspended';
    description: string | null;
    location: string | null;
    photoKey: string | null;
    photoUrl: string | null;
    isOpenOverride: boolean | null;
    acceptingOrders: boolean;
    avgPrepMinutes: number;
    parallelCapacity: number;
    upiEnabled: boolean;
    cashEnabled: boolean;
    routeStatus: 'not_started' | 'pending' | 'activated' | 'rejected' | 'suspended';
    payments: { upi: boolean; cash: boolean };
  };
  hours: HoursSlot[];
  availability: PublicStall['availability'];
}

export type SettingsPatch = Partial<
  Pick<
    StallSettings['settings'],
    | 'isOpenOverride'
    | 'acceptingOrders'
    | 'avgPrepMinutes'
    | 'parallelCapacity'
    | 'description'
    | 'location'
    | 'photoKey'
    | 'upiEnabled'
    | 'cashEnabled'
  >
>;

const path = (stallId: string) => `/v1/vendor/stalls/${encodeURIComponent(stallId)}` as const;
const key = (stallId: string) => ['vendor', 'settings', stallId] as const;

export function useStallSettings(stallId: string) {
  return useQuery({
    queryKey: key(stallId),
    queryFn: () => apiRequest<StallSettings>(`${path(stallId)}/settings`),
    // Open/closed changes on its own when a slot starts or ends.
    refetchInterval: 60_000,
  });
}

function useSettingsMutation<T>(stallId: string, run: (input: T) => Promise<StallSettings>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (data) => {
      queryClient.setQueryData(key(stallId), data);
      void queryClient.invalidateQueries({ queryKey: ['stalls'] });
    },
  });
}

export function useUpdateSettings(stallId: string) {
  return useSettingsMutation(stallId, (patch: SettingsPatch) =>
    apiRequest<StallSettings>(`${path(stallId)}/settings`, { method: 'PATCH', body: patch }),
  );
}

export function useReplaceHours(stallId: string) {
  return useSettingsMutation(stallId, (slots: HoursSlot[]) =>
    apiRequest<StallSettings>(`${path(stallId)}/hours`, { method: 'PUT', body: { slots } }),
  );
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Same slots on every day (the "copy to all days" button). */
export function copyDayToAll(slots: HoursSlot[], weekday: number): HoursSlot[] {
  const day = slots.filter((s) => s.weekday === weekday);
  return [1, 2, 3, 4, 5, 6, 7].flatMap((d) => day.map((s) => ({ ...s, weekday: d })));
}

/** Problems the server would refuse, found before saving (one message per slot index). */
export function hoursProblems(slots: HoursSlot[]): Map<number, string> {
  const problems = new Map<number, string>();
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  slots.forEach((s, i) => {
    if (!/^\d\d:\d\d$/.test(s.opensAt) || !/^\d\d:\d\d$/.test(s.closesAt)) {
      problems.set(i, 'Enter both times');
    } else if (s.opensAt === s.closesAt) {
      problems.set(i, 'Opening and closing times must be different');
    }
  });
  // Same-day overlaps (overnight overlaps are checked by the server).
  slots.forEach((a, i) => {
    if (problems.has(i)) return;
    slots.forEach((b, j) => {
      if (j >= i || problems.has(j) || a.weekday !== b.weekday) return;
      const [as, ae] = [minutes(a.opensAt), minutes(a.closesAt)];
      const [bs, be] = [minutes(b.opensAt), minutes(b.closesAt)];
      if (ae > as && be > bs && as < be && bs < ae) problems.set(i, 'Overlaps another slot on this day');
    });
  });
  return problems;
}
