'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { membershipIdForContact } from '@/lib/memberships/lookup';
import type { Membership } from '@/types';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  PageHeaderActions,
  PageHeaderTabs,
} from '@/components/layout/page-header-actions';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RenewalActionLists } from '@/components/members/renewal-action-lists';
import { FollowUpLists } from '@/components/members/follow-up-lists';
import { TrialActionLists } from '@/components/members/trial-action-lists';
import { InactiveActionLists } from '@/components/members/inactive-action-lists';
import { MembersTable } from '@/components/members/members-table';
import { MemberForm } from '@/components/members/member-form';
import { ImportMembersCsvDialog } from '@/components/members/import-members-csv-dialog';
import { MemberDetailView } from '@/components/members/member-detail-view';
import { AttendanceView } from '@/components/members/attendance-view';
import { PaymentSummaryTiles } from '@/components/members/payment-summary-tiles';
import { PaymentsTable } from '@/components/members/payments-table';
import { useReminderReadiness } from '@/components/members/send-reminder-button';

type View =
  | 'renewals'
  | 'followups'
  | 'trials'
  | 'payments'
  | 'retention'
  | 'all'
  | 'attendance';

const VIEW_LABEL: Record<View, string> = {
  renewals: 'Renewals',
  followups: 'Follow-ups',
  trials: 'Trials',
  payments: 'Payments',
  retention: 'At risk',
  all: 'All members',
  attendance: 'Attendance',
};

const MEMBER_VIEWS = new Set<View>([
  'renewals',
  'followups',
  'trials',
  'payments',
  'retention',
  'all',
  'attendance',
]);

function isMemberView(value: string | null): value is View {
  return value !== null && MEMBER_VIEWS.has(value as View);
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
  const { canSendMessages } = useAuth();
  const readiness = useReminderReadiness();

  const [view, setView] = useState<View>('renewals');
  const [reloadKey, setReloadKey] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Report action links deep-link to the relevant operating queue. Read the
  // requested tab after hydration (the server cannot see window.location in
  // this client page), then keep subsequent tab choices reflected in the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('view');
    if (isMemberView(requested)) {
      // Synchronising component state from the browser URL is the purpose of
      // this effect; it is not derived render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView(requested);
    }
    const requestedMember = params.get('member');
    if (isUuid(requestedMember)) {
      // Finance/Reports deep links open the existing member sheet; no
      // second member-detail surface is created for those analytical pages.
      setDetailId(requestedMember);
      setDetailOpen(true);
    }
  }, []);

  const reload = () => setReloadKey((k) => k + 1);

  // The All-members table owns the filter-aware CSV export; it registers
  // its caller here so the header Export button (shown only on that view)
  // can trigger it without duplicating the query logic.
  const exportFnRef = useRef<(() => void) | null>(null);
  const registerExport = useCallback((fn: (() => void) | null) => {
    exportFnRef.current = fn;
  }, []);

  // Realtime: any membership / payment / attendance change (another
  // device's check-in, a teammate recording a payment) bumps reloadKey,
  // which every list child already refetches on. The bump is trailing-
  // debounced so a bulk write's event burst coalesces into one refetch
  // (migration 054 publishes these tables; RLS scopes events to the
  // account). Subscribes once — the handler only touches stable setState.
  useEffect(() => {
    const supabase = createClient();
    let timer: number | null = null;
    const bump = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setReloadKey((k) => k + 1), 400);
    };
    const channel = supabase
      .channel('member-lists')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'memberships' },
        bump
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        bump
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance' },
        bump
      )
      .subscribe();
    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openDetail(id: string) {
    setDetailId(id);
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
    }
  }

  function editFromDetail(membership: Membership) {
    setEditing(membership);
    setFormOpen(true);
  }

  function changeView(nextView: View) {
    setView(nextView);
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
          onValueChange={(v) => changeView(v as View)}
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
                className="flex-none px-0.5 pb-2 text-[0.9375rem] group-data-horizontal/tabs:after:bottom-0"
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
            reloadKey={reloadKey}
          />
        ) : view === 'followups' ? (
          <FollowUpLists
            readiness={readiness}
            onSelect={openDetail}
            reloadKey={reloadKey}
            onChanged={reload}
            canEdit={canSendMessages}
          />
        ) : view === 'trials' ? (
          <TrialActionLists
            readiness={readiness}
            onSelect={openDetail}
            reloadKey={reloadKey}
          />
        ) : view === 'payments' ? (
          <div className="space-y-6">
            <PaymentSummaryTiles reloadKey={reloadKey} />
            <PaymentsTable
              readiness={readiness}
              onSelect={openDetail}
              reloadKey={reloadKey}
              onChanged={reload}
            />
          </div>
        ) : view === 'retention' ? (
          <InactiveActionLists onSelect={openDetail} reloadKey={reloadKey} />
        ) : view === 'all' ? (
          <MembersTable
            readiness={readiness}
            onSelect={openDetail}
            onEdit={editFromDetail}
            onChanged={reload}
            canEdit={canSendMessages}
            reloadKey={reloadKey}
            onRegisterExport={registerExport}
          />
        ) : (
          <AttendanceView
            reloadKey={reloadKey}
            onAttendanceChanged={reload}
            onSelect={openDetail}
          />
        )}
      </div>

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
              // Contact exists but isn't a member — nothing to open.
              toast.info('Already a contact, but not a member yet.');
            }
            reload();
          })();
        }}
      />

      <ImportMembersCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSaved={reload}
      />

      <MemberDetailView
        membershipId={detailId}
        open={detailOpen}
        reloadKey={reloadKey}
        onOpenChange={changeDetailOpen}
        readiness={readiness}
        onChanged={reload}
        onEdit={editFromDetail}
      />
    </div>
  );
}
