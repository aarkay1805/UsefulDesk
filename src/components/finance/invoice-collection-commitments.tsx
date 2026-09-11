'use client';

import { useEffect, useState } from 'react';
import { Check, Handshake, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import { canCancelInvoiceCollectionCommitment, canCreateInvoiceCollectionCommitment, canEditInvoiceCollectionCommitment, canResolveInvoiceCollectionCommitment } from '@/lib/auth/roles';
import { currencySymbol } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import { useAccountStaff } from '@/components/members/use-account-staff';

type CommitmentKind = 'promise_to_pay' | 'verification_hold' | 'dispute_hold';
type Commitment = {
  id: string; kind: CommitmentKind; state: 'open' | 'fulfilled' | 'broken' | 'resolved' | 'cancelled';
  amount: number | null; promised_on: string | null; reason: string | null; next_action: string;
  assigned_to: string; created_by: string; revision: number; created_at: string;
};

const KIND_LABEL: Record<CommitmentKind, string> = {
  promise_to_pay: 'Promise to pay', verification_hold: 'Verification hold', dispute_hold: 'Dispute hold',
};

function commitmentState(state: Commitment['state']) {
  return state === 'open' ? 'Open' : state === 'fulfilled' ? 'Fulfilled' : state === 'broken' ? 'Broken' : state === 'resolved' ? 'Resolved' : 'Cancelled';
}

export function InvoiceCollectionCommitments({ invoiceId, maxAmount }: { invoiceId: string; maxAmount: number }) {
  const { accountRole, user } = useAuth();
  const { fmt, locale } = useLocale();
  const { staff, nameById } = useAccountStaff();
  const [items, setItems] = useState<Commitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Commitment | null>(null);
  const [kind, setKind] = useState<CommitmentKind>('promise_to_pay');
  const [amount, setAmount] = useState('');
  const [promisedOn, setPromisedOn] = useState('');
  const [reason, setReason] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [assignee, setAssignee] = useState('');
  const [saving, setSaving] = useState(false);

  const canCreate = accountRole ? canCreateInvoiceCollectionCommitment(accountRole) : false;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/commitments`, { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Commitments could not be loaded');
        if (!cancelled) setItems(body.commitments ?? []);
      } catch (error) {
        if (!cancelled) toast.error(getErrorMessage(error, 'Commitments could not be loaded'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [invoiceId, reloadNonce]);

  function refresh() { setReloadNonce((current) => current + 1); }

  function resetForm(item: Commitment | null = null) {
    setEditing(item); setKind(item?.kind ?? 'promise_to_pay'); setAmount(item?.amount != null ? String(item.amount) : '');
    setPromisedOn(item?.promised_on ?? ''); setReason(item?.reason ?? ''); setNextAction(item?.next_action ?? '');
    setAssignee(item?.assigned_to ?? user?.id ?? staff[0]?.user_id ?? '');
  }

  function openCreate() { resetForm(); setDialogOpen(true); }
  function openEdit(item: Commitment) { resetForm(item); setDialogOpen(true); }

  async function save() {
    const numericAmount = Number(amount);
    if (!nextAction.trim() || !assignee || (kind === 'promise_to_pay' && (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > maxAmount || !promisedOn)) || (kind !== 'promise_to_pay' && !reason.trim())) {
      toast.error(kind === 'promise_to_pay' ? 'Enter an amount within the current balance, a date, next action, and assignee' : 'Enter a hold reason, next action, and assignee');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/commitments`, {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing?.id, revision: editing?.revision, kind, amount: kind === 'promise_to_pay' ? numericAmount : null, promisedOn: kind === 'promise_to_pay' ? promisedOn : null, reason: kind === 'promise_to_pay' ? null : reason, nextAction, assignedTo: assignee }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Commitment could not be saved');
      setDialogOpen(false); refresh(); toast.success(editing ? 'Commitment updated' : 'Commitment recorded');
    } catch (error) { toast.error(getErrorMessage(error, 'Commitment could not be saved')); }
    finally { setSaving(false); }
  }

  async function cancel(item: Commitment) {
    setSaving(true);
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/commitments`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, revision: item.revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Commitment could not be cancelled');
      refresh(); toast.success('Commitment cancelled');
    } catch (error) { toast.error(getErrorMessage(error, 'Commitment could not be cancelled')); }
    finally { setSaving(false); }
  }

  async function resolve(item: Commitment) {
    setSaving(true);
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/commitments`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, revision: item.revision, action: 'resolve' }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Commitment could not be resolved');
      refresh(); toast.success('Commitment resolved');
    } catch (error) { toast.error(getErrorMessage(error, 'Commitment could not be resolved')); }
    finally { setSaving(false); }
  }

  return <section className="space-y-2" aria-labelledby={`invoice-commitments-${invoiceId}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 id={`invoice-commitments-${invoiceId}`} className="text-base font-medium">Payment commitments</h3><p className="text-muted-foreground mt-1 text-xs">Promises and verification holds pause automated collection for this invoice.</p></div>
      <GatedButton type="button" variant="outline" size="sm" canAct={canCreate} gateReason="record payment commitments" onClick={openCreate}><Handshake className="size-3.5" /> Add commitment</GatedButton>
    </div>
    {loading ? <p className="text-muted-foreground border-border border-t py-3 text-sm">Loading commitments…</p> : items.length === 0 ? <p className="text-muted-foreground border-border border-t py-3 text-sm">No payment commitment or hold recorded.</p> : <div className="divide-border border-border divide-y border-y">
      {items.map((item) => {
        const editable = accountRole ? canEditInvoiceCollectionCommitment(accountRole, user?.id ?? null, item.created_by) : false;
        const resolvable = accountRole ? canResolveInvoiceCollectionCommitment(accountRole, user?.id ?? null, item.created_by) : false;
        const cancellable = accountRole ? canCancelInvoiceCollectionCommitment(accountRole, user?.id ?? null, item.created_by) : false;
        return <div key={item.id} className="flex min-w-0 flex-wrap items-start gap-2 py-3">
          <ShieldCheck className="text-amber-foreground mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{KIND_LABEL[item.kind]}</p><span className="text-muted-foreground text-xs">{commitmentState(item.state)}</span></div>
            {item.kind === 'promise_to_pay' ? <p className="text-muted-foreground mt-1 text-sm"><span className="tabular-nums">{fmt.money(Number(item.amount))}</span> promised for {item.promised_on ? fmt.date(item.promised_on) : '—'}</p> : <p className="text-muted-foreground mt-1 text-sm">{item.reason}</p>}
            <p className="text-muted-foreground mt-1 text-xs">Next: {item.next_action} · Assigned to {nameById.get(item.assigned_to) ?? 'Former teammate'}</p>
          </div>
          {item.state === 'open' && editable ? <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(item)}>Edit</Button> : null}
          {item.state === 'open' && resolvable ? <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => void resolve(item)}><Check className="size-3.5" /> Resolve</Button> : null}
          {item.state === 'open' && cancellable ? <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => void cancel(item)}><X className="size-3.5" /> Cancel</Button> : null}
        </div>;
      })}
    </div>}
    <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
      <DialogContent className="sm:max-w-[30rem]"><DialogHeader><DialogTitle>{editing ? 'Edit payment commitment' : 'Record payment commitment'}</DialogTitle><DialogDescription>Only the author can edit a commitment. Admin cancellation stays in its audit history.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-1"><div className="grid gap-2"><Label htmlFor="commitment-kind">Type</Label><Select value={kind} onValueChange={(value) => setKind(value as CommitmentKind)} disabled={Boolean(editing)}><SelectTrigger id="commitment-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="promise_to_pay">Promise to pay</SelectItem><SelectItem value="verification_hold">Verification hold</SelectItem><SelectItem value="dispute_hold">Dispute hold</SelectItem></SelectContent></Select></div>
          {kind === 'promise_to_pay' ? <><div className="grid gap-2"><Label htmlFor="commitment-amount">Promised amount</Label><CurrencyInput id="commitment-amount" symbol={currencySymbol(locale.currency)} groupLocale={locale.locale} value={amount} onValueChange={setAmount} aria-label="Promised amount" /></div><div className="grid gap-2"><Label>Promised payment date</Label><DatePicker value={promisedOn} onChange={setPromisedOn} min={fmt.today()} /></div></> : <div className="grid gap-2"><Label htmlFor="commitment-reason">Hold reason</Label><Input id="commitment-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></div>}
          <div className="grid gap-2"><Label htmlFor="commitment-next-action">Staff next action</Label><Input id="commitment-next-action" value={nextAction} onChange={(event) => setNextAction(event.target.value)} maxLength={500} /></div>
          <div className="grid gap-2"><Label htmlFor="commitment-assignee">Assign to</Label><Select value={assignee} onValueChange={(value) => setAssignee(value ?? '')}><SelectTrigger id="commitment-assignee" className="w-full"><SelectValue placeholder="Choose a teammate" /></SelectTrigger><SelectContent>{staff.map((person) => <SelectItem key={person.user_id} value={person.user_id}>{person.full_name}</SelectItem>)}</SelectContent></Select></div>
        </div><DialogFooter><Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="button" loading={saving} onClick={() => void save()}>{editing ? 'Save changes' : 'Record commitment'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
