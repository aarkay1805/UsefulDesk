'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Download, Loader2, Plus, Upload } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { membershipIdForContact } from '@/lib/memberships/lookup';
import {
  MEMBER_REALTIME_TABLES,
  MEMBER_VIEWS,
  memberViewsAffectedByRealtime,
  type MemberRealtimeTable,
  type MemberView,
} from '@/lib/memberships/member-realtime';
import type { Membership } from '@/types';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  PageHeaderActions,
  PageHeaderTabs,
} from '@/components/layout/page-header-actions';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RenewalActionLists } from '@/components/members/renewal-action-lists';
import { useReminderReadiness } from '@/components/members/send-reminder-button';
import { TableSkeleton } from '@/components/table/table-skeleton';

function MembersViewLoading() {
  return (
    <div
      role="status"
      className="text-muted-foreground flex items-center gap-2 py-12 text-sm"
    >
      <Loader2 className="size-4 animate-spin" /> Loading view…
    </div>
  );
}

function MembersTableViewLoading() {
  return (
    <TableSkeleton
      className="min-w-[900px] table-fixed"
      label="Loading member table"
      rows={8}
      columns={[
        { label: '', variant: 'checkbox', width: 40 },
        { label: 'Name', variant: 'identity', width: 220 },
        { label: 'Member ID', width: 120 },
        { label: 'Plan', width: 150 },
        { label: 'Expiry', width: 130 },
        { label: 'Status', variant: 'badge', width: 140 },
        {
          label: 'Actions',
          variant: 'actions',
          width: 240,
          headClassName: 'text-right',
        },
      ]}
    />
  );
}

const FollowUpLists = dynamic(
  () =>
    import('@/components/members/follow-up-lists').then(
      (module) => module.FollowUpLists
    ),
  { loading: MembersTableViewLoading }
);
const TrialActionLists = dynamic(
  () =>
    import('@/components/members/trial-action-lists').then(
      (module) => module.TrialActionLists
    ),
  { loading: MembersViewLoading }
);
const InactiveActionLists = dynamic(
  () =>
    import('@/components/members/inactive-action-lists').then(
      (module) => module.InactiveActionLists
    ),
  { loading: MembersViewLoading }
);
const MembersTable = dynamic(
  () =>
    import('@/components/members/members-table').then(
      (module) => module.MembersTable
    ),
  { loading: MembersTableViewLoading }
);
const MemberForm = dynamic(() =>
  import('@/components/members/member-form').then((module) => module.MemberForm)
);
const ImportMembersCsvDialog = dynamic(() =>
  import('@/components/members/import-members-csv-dialog').then(
    (module) => module.ImportMembersCsvDialog
  )
);
const MemberDetailView = dynamic(() =>
  import('@/components/members/member-detail-view').then(
    (module) => module.MemberDetailView
  )
);
const AttendanceView = dynamic(
  () =>
    import('@/components/members/attendance-view').then(
      (module) => module.AttendanceView
    ),
  { loading: MembersTableViewLoading }
);
const PaymentsTable = dynamic(
  () =>
    import('@/components/members/payments-table').then(
      (module) => module.PaymentsTable
    ),
  { loading: MembersTableViewLoading }
);

const INITIAL_RELOAD_KEYS: Record<MemberView, number> = {
  renewals: 0,
  followups: 0,
  trials: 0,
  payments: 0,
  retention: 0,
  all: 0,
  attendance: 0,
};

const VIEW_LABEL: Record<MemberView, string> = {
  renewals: 'Renewals',
  followups: 'Follow-ups',
  trials: 'Trials',
  payments: 'Payments',
  retention: 'At risk',
  all: 'All members',
  attendance: 'Attendance',
};

function isMemberView(value: string | null): value is MemberView {
  return value !== null && MEMBER_VIEWS.includes(value as MemberView);
}

function isUuid(value: string | null): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

export default function MembersPage() {
  const { accountId, canSendMessages } = useAuth();
  const readiness = useReminderReadiness();
  const searchParams = useSearchParams();

  const requestedView = searchParams.get('view');
  const view: MemberView = isMemberView(requestedView)
    ? requestedView
    : 'renewals';
  const [reloadKeys, setReloadKeys] =
    useState<Record<MemberView, number>>(INITIAL_RELOAD_KEYS);
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const [detailFollowUpReloadKey, setDetailFollowUpReloadKey] = useState(0);
  const pendingRealtimeViewsRef = useRef(new Set<MemberView>());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Finance/Reports deep links open the existing member sheet; no second
  // member-detail surface is created for those analytical pages.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMember = params.get('member');
    if (!isUuid(requestedMember)) return;

    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) {
        setDetailId(requestedMember);
        setDetailOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Dashboard "New Member" deep-links here because this page owns the
  // canonical MemberForm. Wait for the role capability to resolve before
  // opening it; viewers keep the same read-only behavior as the header CTA.
  useEffect(() => {
    if (!canSendMessages) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') !== 'new') return;
    // Synchronising the page-owned dialog with an explicit URL action is the
    // purpose of this effect; it must react when profile loading resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormOpen(true);
  }, [canSendMessages]);

  const reload = () => {
    setReloadKeys((current) => ({
      ...current,
      [view]: current[view] + 1,
    }));
    setDetailReloadKey((key) => key + 1);
  };

  // The All-members table owns the filter-aware CSV export; it registers
  // its caller here so the header Export button (shown only on that view)
  // can trigger it without duplicating the query logic.
  const exportFnRef = useRef<(() => void) | null>(null);
  const registerExport = useCallback((fn: (() => void) | null) => {
    exportFnRef.current = fn;
  }, []);

  // A newly selected child always performs its own fresh mount request. If it
  // was waiting in the Realtime debounce set, that mount satisfies the event;
  // removing it prevents a second request when the timer later flushes.
  useEffect(() => {
    pendingRealtimeViewsRef.current.delete(view);
  }, [view]);

  // One selected-account channel covers the base and indirect tables that can
  // change a Members listing. A burst accumulates affected view tokens and
  // bumps each once after the existing trailing debounce. Inactive children
  // remain unmounted; a tab selected before the timer fires refreshes only if
  // its displayed data depends on at least one event in the burst.
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let timer: number | null = null;
    const pendingViews = pendingRealtimeViewsRef.current;
    let detailPending = false;
    let detailFollowUpPending = false;
    const flush = () => {
      const affectedViews = [...pendingViews];
      const shouldReloadDetail = detailPending;
      const shouldReloadDetailFollowUps = detailFollowUpPending;
      pendingViews.clear();
      detailPending = false;
      detailFollowUpPending = false;
      timer = null;
      if (affectedViews.length > 0) {
        setReloadKeys((current) => {
          const next = { ...current };
          for (const pendingView of affectedViews) {
            next[pendingView] += 1;
          }
          return next;
        });
      }
      if (shouldReloadDetail) setDetailReloadKey((key) => key + 1);
      if (shouldReloadDetailFollowUps) {
        setDetailFollowUpReloadKey((key) => key + 1);
      }
    };
    const schedule = (table: MemberRealtimeTable) => {
      for (const affectedView of memberViewsAffectedByRealtime(table)) {
        pendingViews.add(affectedView);
      }
      // The sheet's notes timeline has its own two-read boundary; do not turn a
      // follow-up event into the detail pane's billing/attendance waterfall.
      if (table === 'follow_ups') detailFollowUpPending = true;
      else detailPending = true;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(flush, 400);
    };
    let channel = supabase.channel('member-lists');
    for (const table of MEMBER_REALTIME_TABLES) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
        },
        (payload) => {
          // DELETE payloads contain only the primary key unless a table uses
          // REPLICA IDENTITY FULL, so a server-side account_id filter would
          // silently drop deletes. Reject a different selected account when
          // the row carries one; otherwise let the RLS-scoped delete refresh
          // the selected branch.
          const newRow = payload.new as Record<string, unknown>;
          const oldRow = payload.old as Record<string, unknown>;
          const changedAccountId =
            typeof newRow.account_id === 'string'
              ? newRow.account_id
              : typeof oldRow.account_id === 'string'
                ? oldRow.account_id
                : null;
          if (changedAccountId && changedAccountId !== accountId) return;
          schedule(table);
        }
      );
    }
    channel.subscribe();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      pendingViews.clear();
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openDetail(
    customer: string | { contactId: string; membershipId: string | null }
  ) {
    setDetailId(
      typeof customer === 'string' ? customer : customer.membershipId
    );
    setDetailContactId(
      typeof customer === 'string' ? null : customer.contactId
    );
    setDetailOpen(true);
  }

  function changeDetailOpen(open: boolean) {
    setDetailOpen(open);
    if (!open) {
      const url = new URL(window.location.href);
      if (url.searchParams.get('member') === detailId) {
        url.searchParams.delete('member');
        window.history.replaceState(null, '', url);
      }
      setDetailContactId(null);
    }
  }

  function editFromDetail(membership: Membership) {
    setEditing(membership);
    setFormOpen(true);
  }

  function changeView(nextView: MemberView) {
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextView);
    window.history.replaceState(null, '', url);
  }

  return (
    <div>
      {/* App-bar actions — portalled into the shared header next to the
          "Members" title, so the page doesn't own a second title row
          (mirrors /leads). */}
      <PageHeaderActions>
        <GatedButton
          canAct={canSendMessages}
          gateReason="import members"
          variant="ghost"
          onClick={() => setImportOpen(true)}
        >
          <Download className="size-4" /> Import
        </GatedButton>
        {/* Export — surfaces the All-members table's filter-aware CSV
            export; only meaningful (and only wired) on that view. */}
        {view === 'all' && (
          <Button variant="ghost" onClick={() => exportFnRef.current?.()}>
            <Upload className="size-4" /> Export
          </Button>
        )}
        <GatedButton
          canAct={canSendMessages}
          gateReason="import or add members"
          onClick={openAdd}
        >
          <Plus className="size-4" /> Add member
        </GatedButton>
      </PageHeaderActions>

      {/* View tabs — portalled into the shared header's tab row so the
          nav reads as part of the header, with the header divider falling
          after it (see PageHeaderTabs / header.tsx). */}
      <PageHeaderTabs>
        <Tabs
          value={view}
          onValueChange={(v) => changeView(v as MemberView)}
          className="pt-2 pb-0"
        >
          <TabsList variant="line" className="h-auto gap-5 p-0">
            {(
              [
                'renewals',
                'followups',
                'trials',
                'payments',
                'retention',
                'all',
                'attendance',
              ] as const
            ).map((v) => (
              <TabsTrigger
                key={v}
                value={v}
                // Underline pinned to the row's bottom edge (overrides the
                // master's -5px float) so it rests on the header divider —
                // and never overflows into the scroll container.
                className="flex-none px-0.5 pb-2 text-sm group-data-horizontal/tabs:after:bottom-0"
              >
                {VIEW_LABEL[v]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeaderTabs>

      <div>
        {view === 'renewals' ? (
          <RenewalActionLists
            readiness={readiness}
            onSelect={openDetail}
            reloadKey={reloadKeys.renewals}
          />
        ) : view === 'followups' ? (
          <FollowUpLists
            readiness={readiness}
            onSelect={openDetail}
            reloadKey={reloadKeys.followups}
            onChanged={reload}
            canEdit={canSendMessages}
          />
        ) : view === 'trials' ? (
          <TrialActionLists
            readiness={readiness}
            onSelect={openDetail}
            reloadKey={reloadKeys.trials}
          />
        ) : view === 'payments' ? (
          <PaymentsTable
            readiness={readiness}
            onSelect={openDetail}
            reloadKey={reloadKeys.payments}
            onChanged={reload}
          />
        ) : view === 'retention' ? (
          <InactiveActionLists
            readiness={readiness}
            onSelect={openDetail}
            reloadKey={reloadKeys.retention}
          />
        ) : view === 'all' ? (
          <MembersTable
            readiness={readiness}
            onSelect={openDetail}
            onEdit={editFromDetail}
            onChanged={reload}
            canEdit={canSendMessages}
            reloadKey={reloadKeys.all}
            onRegisterExport={registerExport}
          />
        ) : (
          <AttendanceView
            readiness={readiness}
            reloadKey={reloadKeys.attendance}
            onAttendanceChanged={reload}
            onSelect={openDetail}
          />
        )}
      </div>

      {formOpen ? (
        <MemberForm
          open={formOpen}
          onOpenChange={setFormOpen}
          member={editing}
          onSaved={reload}
          onViewExisting={(contactId) => {
            // The dedupe path hands back a contact id; member detail is
            // keyed by membership id, so resolve it and open their sheet.
            void (async () => {
              const membershipId = await membershipIdForContact(
                createClient(),
                contactId
              );
              if (membershipId) {
                openDetail(membershipId);
              } else {
                openDetail({ contactId, membershipId: null });
              }
              reload();
            })();
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportMembersCsvDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onSaved={reload}
        />
      ) : null}

      {detailOpen ? (
        <MemberDetailView
          membershipId={detailId}
          contactId={detailContactId}
          open={detailOpen}
          reloadKey={detailReloadKey}
          followUpReloadKey={detailFollowUpReloadKey}
          onOpenChange={changeDetailOpen}
          readiness={readiness}
          onChanged={reload}
          onEdit={editFromDetail}
        />
      ) : null}
    </div>
  );
}
