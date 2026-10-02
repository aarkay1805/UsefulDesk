'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useLocale } from '@/hooks/use-locale';
import type { AccessStatus } from '@/lib/platform-access/model';
import { AccessStatusBadge } from './access-status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResolvableAction } from '@/components/ui/resolvable-action';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

const evidenceFields = {
  buyer_geography_reference: 'Buyer and billing geography review',
  issuer_financial_year_reference: 'Supplier and financial year review',
  tax_receipt_review_reference: 'Tax and document review',
  refund_policy_reference: 'Refund and support review',
  merchant_approval_reference: 'Payment account review',
  provider_acceptance_reference: 'Payment acceptance evidence',
  backup_recovery_reference: 'Backup and recovery evidence',
  authorization_reference: 'Operator authorization',
  offer_reference: 'Exact Starter offer reference',
  customer_tax_note: 'Tax note for the customer',
  customer_terms_note: 'Terms for the customer',
  release_sha: 'Reviewed release SHA',
  migration_manifest_sha256: 'Reviewed migration manifest SHA-256',
} as const;
const missingFactLabels: Record<string, string> = {
  verified_owner: 'Confirm one actual verified owner',
  normal_trial: 'Review the normal trial and any access exception',
  one_active_branch: 'Review the active branch count',
  inr_branch: 'Confirm INR billing for the selected branch',
  buyer_details: 'Complete buyer details',
  gym_setup: 'Review gym setup and active plan prices',
  payment_readiness: 'Review payment intake and settlement readiness',
  standard_reminders: 'Review the approved standard reminder schedule',
  existing_obligation: 'Review the existing financial obligation',
};
const stages: Record<string, string> = {
  commercial_review_required: 'Review required',
  preparation_closed: 'Prepared, opening closed',
  owner_review_required: 'Owner review required',
  owner_reviewed: 'Owner reviewed',
  checkout_opened: 'Checkout opened',
  checkout_paused: 'Checkout paused',
  payment_verified: 'Payment verified',
};
const workStatuses = {
  awaiting_facts: 'Waiting for facts',
  in_review: 'In review',
  blocked: 'Blocked',
} as const;
type WorkStatus = keyof typeof workStatuses;
type Signup = {
  organization_id: string;
  name: string;
  selected_at: string;
  operator_user_id: string;
  operator_name: string;
  review_status: string;
  access_status: AccessStatus;
  trial_ends_at: string | null;
  active_branches: number;
  revision: number;
  work_status: WorkStatus;
  next_action: string;
  evidence: Record<string, string>;
  snapshot_token: string;
  missing_facts: string[];
  preparation_id: string | null;
  preparation_stale: boolean;
  branches: {
    account_id: string;
    name: string;
    currency: string;
    buyer_complete: boolean;
    setup_complete: boolean;
  }[];
  operators: { user_id: string; name: string }[];
};

export function StarterSignupQueue() {
  const { fmt } = useLocale();
  const [offset, setOffset] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{
    items: Signup[];
    total: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Signup | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setResult(null);
      setError('');
      try {
        const { data, error } = await createClient().rpc(
          'platform_admin_starter_signup_queue',
          { p_limit: 25, p_offset: offset }
        );
        if (error) throw error;
        if (!cancelled) setResult(data);
      } catch (err) {
        if (!cancelled)
          setError(
            getErrorMessage(
              err,
              'Could not load new gym businesses. Refresh and try again.'
            )
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offset, nonce]);
  function refresh() {
    setSelected(null);
    setNonce((n) => n + 1);
  }
  return (
    <section aria-labelledby="starter-signups-title" className="space-y-4">
      <h2 id="starter-signups-title" className="font-semibold">
        Prepare new gym businesses
      </h2>
      <p className="text-muted-foreground text-sm">
        Every selected registration keeps its full 14-day trial. Preparation
        does not approve or collect payment.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!result && !error ? (
        <p role="status">Loading new gym businesses…</p>
      ) : null}
      {result?.items.map((item) => (
        <Card key={item.organization_id}>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 font-medium">{item.name}</p>
              <AccessStatusBadge status={item.access_status} />
              <Badge
                variant={
                  item.preparation_stale
                    ? 'warning'
                    : item.review_status === 'payment_verified'
                      ? 'success'
                      : 'neutral'
                }
              >
                {item.preparation_stale
                  ? 'Review changed facts'
                  : stages[item.review_status] || 'Review required'}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              Assigned to: <span>{item.operator_name}</span> ·{' '}
              {workStatuses[item.work_status]}
            </p>
            <p className="text-sm">{item.next_action}</p>
            {item.trial_ends_at ? (
              <p className="text-muted-foreground text-sm">
                Trial expires {fmt.dateTime(item.trial_ends_at)}
              </p>
            ) : null}
            <Button variant="outline" onClick={() => setSelected(item)}>
              Review preparation
            </Button>
          </CardContent>
        </Card>
      ))}
      {result?.items.length === 0 ? (
        <p>
          No new gym businesses to prepare. Future selected registrations appear
          here for operator review.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={offset === 0}
          onClick={() => {
            setSelected(null);
            setOffset((n) => Math.max(0, n - 25));
          }}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={!result || offset + 25 >= result.total}
          onClick={() => {
            setSelected(null);
            setOffset((n) => n + 25);
          }}
        >
          Next
        </Button>
        <Button variant="ghost" loading={!result && !error} onClick={refresh}>
          Refresh preparation
        </Button>
      </div>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          side="right"
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle className="mr-8">
              {selected?.name || 'Gym preparation'}
            </SheetTitle>
            <SheetDescription>
              Prepare the exact Starter offer and keep each missing fact
              visible.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-4 pb-4">
              {selected ? (
                <PreparationEditor
                  key={`${selected.organization_id}:${selected.revision}`}
                  item={selected}
                  onChanged={refresh}
                />
              ) : null}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function PreparationEditor({
  item,
  onChanged,
}: {
  item: Signup;
  onChanged: () => void;
}) {
  const { fmt } = useLocale();
  const [operator, setOperator] = useState(item.operator_user_id);
  const [status, setStatus] = useState(item.work_status);
  const [nextAction, setNextAction] = useState(item.next_action);
  const [evidence, setEvidence] = useState(item.evidence);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<'save' | 'freeze' | null>(null);
  const [error, setError] = useState('');
  const frozen = item.preparation_id !== null;
  const dirty =
    operator !== item.operator_user_id ||
    status !== item.work_status ||
    nextAction !== item.next_action ||
    JSON.stringify(evidence) !== JSON.stringify(item.evidence);
  const freezeBlocker = item.missing_facts.length
    ? {
        title: 'Complete the review first',
        description:
          'Add actual buyer and setup details, then save every review reference.',
      }
    : dirty || item.revision === 0
      ? {
          title: 'Save preparation first',
          description: 'Save these changes before confirming the final review.',
        }
      : status !== 'in_review'
        ? {
            title: 'Mark the review in progress',
            description:
              'Choose In review and save after checking the actual evidence.',
          }
        : null;
  async function submit(action: 'save' | 'freeze') {
    setPending(action);
    setError('');
    try {
      const { error } =
        action === 'save'
          ? await createClient().rpc(
              'platform_admin_save_starter_signup_work',
              {
                p_organization_id: item.organization_id,
                p_expected_revision: item.revision,
                p_expected_snapshot: item.snapshot_token,
                p_operator_user_id: operator,
                p_status: status,
                p_next_action: nextAction.trim(),
                p_evidence: frozen
                  ? item.evidence
                  : Object.fromEntries(
                      Object.entries(evidence)
                        .map(([key, value]) => [key, value.trim()])
                        .filter(([, value]) => value)
                    ),
              }
            )
          : await createClient().rpc(
              'platform_admin_freeze_starter_signup_preparation',
              {
                p_organization_id: item.organization_id,
                p_expected_revision: item.revision,
                p_confirm_reviewed: confirmed,
              }
            );
      if (error) throw error;
      toast.success(
        action === 'save'
          ? 'Preparation saved'
          : 'Preparation frozen. Opening stays closed.'
      );
      onChanged();
    } catch (err) {
      const message = getErrorMessage(
        err,
        'Could not save preparation. Refresh and try again.'
      );
      setError(message);
      toast.error(message);
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription>
          <span className="tabular-nums">{fmt.money(799, 'INR')}</span> gross
          for one calendar month from verified payment. One active branch.
          Standard reminders: 7, 3 and 1 days before expiry, after 09:00 in the
          branch timezone.
          <p>
            The owner reviews after trial expiry. Verified payment grants paid
            access.
          </p>
        </AlertDescription>
      </Alert>
      {item.branches.map((branch) => (
        <p key={branch.account_id} className="text-sm">
          {branch.name} · {branch.currency} · Buyer details{' '}
          {branch.buyer_complete ? 'complete' : 'missing'} · Setup{' '}
          {branch.setup_complete ? 'reviewed' : 'needs review'}
        </p>
      ))}
      {item.preparation_stale ? (
        <Alert variant="destructive">
          <AlertDescription>
            Customer facts changed after preparation. Ask the release operator
            to review a replacement. Do not enable this preparation.
          </AlertDescription>
        </Alert>
      ) : null}
      {frozen ? (
        <Alert>
          <AlertDescription>
            Preparation reference: {item.preparation_id}.{' '}
            {stages[item.review_status] || 'Review required'}.
            <p>
              The release operator must separately authorize owner review after
              actual expiry. The customer must approve in their own account.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {item.missing_facts.length ? (
        <section className="space-y-2">
          <h3 className="font-semibold">Missing facts</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {item.missing_facts.map((key) => (
              <li key={key}>
                {missingFactLabels[key] ||
                  evidenceFields[key as keyof typeof evidenceFields] ||
                  'Review required'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit('save');
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="starter-operator">Assigned to</Label>
          <Select
            value={operator}
            onValueChange={(value) => {
              if (value) setOperator(value);
            }}
          >
            <SelectTrigger id="starter-operator" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {item.operators.map((op) => (
                <SelectItem key={op.user_id} value={op.user_id}>
                  {op.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="starter-status">Status</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              if (value) setStatus(value as WorkStatus);
            }}
          >
            <SelectTrigger id="starter-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(workStatuses).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="starter-next">Next step</Label>
          <Textarea
            id="starter-next"
            minLength={3}
            maxLength={1000}
            required
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          Link actual evidence. Leave unknown facts blank. A reference alone
          does not prove commercial or tax readiness.
        </p>
        {Object.entries(evidenceFields).map(([key, label]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={`starter-${key}`}>{label}</Label>
            <Input
              id={`starter-${key}`}
              value={evidence[key] || ''}
              maxLength={2000}
              readOnly={frozen}
              onChange={(event) =>
                setEvidence((old) => ({ ...old, [key]: event.target.value }))
              }
            />
          </div>
        ))}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          type="submit"
          loading={pending === 'save'}
          disabled={pending !== null || nextAction.trim().length < 3}
        >
          Save preparation
        </Button>
      </form>
      {!frozen ? (
        <section className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="starter-confirm"
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
            />
            <Label htmlFor="starter-confirm">
              I checked the buyer, setup and every saved review reference.
            </Label>
          </div>
          <p className="text-muted-foreground text-sm">
            Freezing saves an immutable offer and preparation. Opening stays
            closed. Changed facts need a separate review.
          </p>
          <ResolvableAction
            trigger={
              <Button
                loading={pending === 'freeze'}
                disabled={!confirmed || pending !== null}
              >
                Freeze preparation
              </Button>
            }
            blocker={freezeBlocker}
            disabled={!confirmed || pending !== null}
            onAction={() => void submit('freeze')}
          />
        </section>
      ) : null}
    </div>
  );
}
