"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";
import { supabase } from "./supabase";
import type { Stall } from "./types";

/**
 * Stalls the signed-in vendor owns (admins see every stall), plus the one
 * currently selected in the dashboard.
 */
export function useMyStalls() {
  const { session, profile } = useAuth();
  const [stalls, setStalls] = useState<Stall[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session || !profile) return;
    let q = supabase.from("stalls").select("*").order("name");
    if (profile.role !== "admin") q = q.eq("owner_id", session.user.id);
    const { data } = await q;
    const list = (data as Stall[]) ?? [];
    setStalls(list);
    setSelectedId((cur) => cur ?? localStorageGet("mom.vendor.stall") ?? list[0]?.id ?? null);
  }, [session, profile]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    reload();
  }, [reload]);

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem("mom.vendor.stall", id);
    } catch {}
  };

  const stall = stalls?.find((s) => s.id === selectedId) ?? stalls?.[0] ?? null;
  return { stalls, stall, select, reload };
}

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
