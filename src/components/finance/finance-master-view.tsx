'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { FinanceOverview } from '@/components/finance/finance-overview';
import { PageHeaderTabs } from '@/components/layout/page-header-actions';
import { MemberDetailView } from '@/components/members/member-detail-view';
import { MemberForm } from '@/components/members/member-form';
import { PaymentsTable } from '@/components/members/payments-table';
import { useReminderReadiness } from '@/components/members/send-reminder-button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  financeHref,
  type FinanceCollectionView,
  type FinanceView,
} from '@/lib/finance/views';
import { createClient } from '@/lib/supabase/client';
import type { Membership } from '@/types';

const VIEW_LABEL: Record<FinanceView, string> = {
  overview: 'Overview',
  collections: 'Collections',
};

export function FinanceMasterView({
  view,
  collectionView,
}: {
  view: FinanceView;
  collectionView: FinanceCollectionView;
}) {
  const router = useRouter();
  const readiness = useReminderReadiness();
  const [reloadKey, setReloadKey] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState<Membership | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    const supabase = createClient();
    let timer: number | null = null;
    const bump = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setReloadKey((key) => key + 1), 400);
    };
    const channel = supabase
      .channel('finance-lists')
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
        { event: '*', schema: 'public', table: 'payment_mandates' },
        bump
      )
      .subscribe();

    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  function openDetail(membershipId: string) {
    setDetailId(membershipId);
    setDetailOpen(true);
  }

  function editMember(membership: Membership) {
    setEditing(membership);
    setEditOpen(true);
  }

  function changeView(next: FinanceView) {
    router.replace(financeHref(next, collectionView), { scroll: false });
  }

  function changeCollectionView(next: FinanceCollectionView) {
    router.replace(financeHref('collections', next), { scroll: false });
  }

  return (
    <div>
      <PageHeaderTabs>
        <Tabs
          value={view}
          onValueChange={(value) => changeView(value as FinanceView)}
          className="pt-2 pb-0"
        >
          <TabsList variant="line" className="h-auto gap-5 p-0">
            {(['overview', 'collections'] as const).map((value) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex-none px-0.5 pb-2 text-[0.9375rem] group-data-horizontal/tabs:after:bottom-0"
              >
                {VIEW_LABEL[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeaderTabs>

      {view === 'overview' ? (
        <FinanceOverview reloadKey={reloadKey} />
      ) : (
        <PaymentsTable
          readiness={readiness}
          onSelect={openDetail}
          reloadKey={reloadKey}
          onChanged={reload}
          initialView={collectionView}
          onViewChange={changeCollectionView}
        />
      )}

      <MemberForm
        open={editOpen}
        onOpenChange={setEditOpen}
        member={editing}
        onSaved={reload}
      />

      <MemberDetailView
        membershipId={detailId}
        open={detailOpen}
        reloadKey={reloadKey}
        onOpenChange={setDetailOpen}
        readiness={readiness}
        onChanged={reload}
        onEdit={editMember}
      />
    </div>
  );
}
