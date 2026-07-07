"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export interface StaffMember {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
}

/**
 * Load the account's teammates for assignee pickers/labels. RLS on
 * profiles lets any member read rows in their own account, so this is
 * naturally account-scoped (same read the Members roster API does).
 */
export function useAccountStaff() {
  const { accountId } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .eq("account_id", accountId)
        .order("full_name", { ascending: true });
      if (cancelled) return;
      setStaff(
        ((data as StaffMember[]) ?? []).map((s) => ({
          user_id: s.user_id,
          full_name: s.full_name || "Teammate",
          avatar_url: s.avatar_url ?? null,
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  /** user_id → display name, for rendering assignee chips. */
  const nameById = useMemo(
    () => new Map(staff.map((s) => [s.user_id, s.full_name])),
    [staff],
  );

  /** user_id → avatar photo URL (null = no upload), for UserAvatar. */
  const avatarById = useMemo(
    () => new Map(staff.map((s) => [s.user_id, s.avatar_url])),
    [staff],
  );

  return { staff, nameById, avatarById, loading };
}
