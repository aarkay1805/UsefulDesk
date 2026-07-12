'use client';

// BulkConvertDialog — convert the selected leads into members. Same net
// effect as the "Convert" button on a lead's detail page (create a
// membership so the contact becomes a member and drops off the leads
// list), applied to many leads at once with one shared plan + start date.
//
// Selected leads are never already members (the leads list anti-joins
// memberships), so each conversion is a clean membership insert. It still
// inserts per lead and tallies skips (unique violation) / failures so a
// stray edge case can't wipe the whole batch.

import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { useMembershipPlans } from '@/components/members/use-membership-plans';
import { istAddDays } from '@/lib/memberships/expiry';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

// Select-style trigger matching the bulk-edit dialog's pickers (border +
// chevron) so the plan dropdown looks and pads identically.
const TRIGGER_CLASS =
  'flex h-9 w-full items-center justify-between gap-1.5 rounded-lg border border-input-border bg-transparent px-3 text-sm whitespace-nowrap outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

export function BulkConvertDialog({
  open,
  onOpenChange,
  contactIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The leads to convert into members. */
  contactIds: string[];
  /** Called after a successful conversion so the page can refresh. */
  onDone?: () => void;
}) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const { fmt } = useLocale();
  const { plans } = useMembershipPlans(true);

  const [planId, setPlanId] = useState('');
  const [startDate, setStartDate] = useState(fmt.today());
  const [saving, setSaving] = useState(false);

  // Reset the form each time the dialog opens. Done during render (not an
  // effect) so it never trips the repo's set-state-in-effect rule.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPlanId('');
      setStartDate(fmt.today());
      setSaving(false);
    }
  }

  const count = contactIds.length;
  const plan = plans.find((p) => p.id === planId);

  async function handleConvert() {
    if (!plan || count === 0) return;
    if (!accountId || !user) {
      toast.error('Not authenticated');
      return;
    }
    if (!startDate) {
      toast.error('Pick a start date');
      return;
    }

    setSaving(true);
    const endDate = istAddDays(startDate, plan.duration_days);
    // One membership per lead. Insert individually so a lead that's somehow
    // already a member is skipped (unique violation) without failing rest.
    const results = await Promise.all(
      contactIds.map((id) =>
        supabase
          .from('memberships')
          .insert({
            account_id: accountId,
            contact_id: id,
            user_id: user.id,
            plan_id: plan.id,
            start_date: startDate,
            end_date: endDate,
            status: 'active',
            fee_amount: plan.price,
            fee_status: 'due',
            is_trial: false,
          })
          .select('id')
      )
    );

    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const r of results) {
      if (!r.error) created++;
      else if (isUniqueViolation(r.error)) skipped++;
      else failed++;
    }

    if (created) {
      const parts = [
        `${created} lead${created === 1 ? '' : 's'} converted to member${created === 1 ? '' : 's'}`,
      ];
      if (skipped) parts.push(`${skipped} already a member`);
      if (failed) parts.push(`${failed} failed`);
      toast.success(parts.join(' · '));
    } else {
      toast.error(
        skipped
          ? 'Those leads are already members'
          : 'Failed to convert leads'
      );
    }

    setSaving(false);
    if (created) {
      onOpenChange(false);
      onDone?.();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Convert {count} {count === 1 ? 'lead' : 'leads'} to{' '}
            {count === 1 ? 'a member' : 'members'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Start a membership for {count === 1 ? 'this lead' : 'these leads'}.
            They move to the Members list.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-popover-foreground">Membership plan</Label>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button type="button" className={TRIGGER_CLASS} />}
              >
                <span className={cn('truncate', !plan && 'text-muted-foreground')}>
                  {plan ? (
                    <>
                      {plan.name} · {plan.duration_days}d ·{' '}
                      <span className="tabular-nums">{fmt.money(plan.price)}</span>
                    </>
                  ) : (
                    'Select a plan'
                  )}
                </span>
                <ChevronDown className="text-muted-foreground size-4 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="bg-popover border-border"
              >
                {plans.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => setPlanId(p.id)}
                    className="text-popover-foreground focus:bg-muted focus:text-foreground"
                  >
                    {p.name} · {p.duration_days}d ·{' '}
                    <span className="tabular-nums">{fmt.money(p.price)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {plans.length === 0 && (
              <p className="text-muted-foreground text-xs">
                No active plans. Create one in Settings → Membership plans.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-popover-foreground">Start date</Label>
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              className="border-border"
            />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button onClick={handleConvert} disabled={!plan || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
