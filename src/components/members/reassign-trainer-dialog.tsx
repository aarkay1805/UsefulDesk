'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useLocale } from '@/hooks/use-locale';
import { createClient } from '@/lib/supabase/client';
import { daysBetween } from '@/lib/memberships/expiry';
import type { MemberService, Trainer, TrainerRate } from '@/types';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function ReassignTrainerDialog({
  service,
  open,
  onOpenChange,
  onSaved,
}: {
  service: MemberService | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { fmt } = useLocale();
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [rates, setRates] = useState<TrainerRate[]>([]);
  const [trainerId, setTrainerId] = useState<string | null>(null);
  const [switchDate, setSwitchDate] = useState(fmt.today());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open || !service?.catalog_option_id) return;
    let cancelled = false;
    void (async () => {
      const [trainerResult, rateResult] = await Promise.all([
        supabase
          .from('trainers')
          .select('*')
          .eq('is_active', true)
          .order('display_name'),
        supabase
          .from('trainer_rates')
          .select('*')
          .eq('option_id', service.catalog_option_id)
          .eq('is_active', true),
      ]);
      if (cancelled) return;
      setTrainers((trainerResult.data as Trainer[]) ?? []);
      setRates((rateResult.data as TrainerRate[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, service?.catalog_option_id, supabase]);

  const available = trainers.filter(
    (trainer) =>
      trainer.id !== service?.trainer_id &&
      rates.some((rate) => rate.trainer_id === trainer.id)
  );
  const rate = rates.find((candidate) => candidate.trainer_id === trainerId);
  const totalDays = service
    ? daysBetween(service.start_date, service.end_date)
    : 0;
  const remainingDays = service
    ? Math.max(daysBetween(switchDate, service.end_date), 0)
    : 0;
  const adjustment =
    service && rate && totalDays > 0
      ? Math.round(
          (Number(rate.price) -
            Number(service.assigned_full_rate ?? service.sold_amount)) *
            (remainingDays / totalDays) *
            100
        ) / 100
      : 0;

  async function reassign() {
    if (!service || !trainerId || !reason.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.rpc(
      'reassign_member_service_trainer',
      {
        p_member_service_id: service.id,
        p_new_trainer_id: trainerId,
        p_switch_date: switchDate,
        p_reason: reason.trim(),
        p_idempotency_key: idempotencyKey,
      }
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    const result = data as { adjustment?: number } | null;
    const actual = Number(result?.adjustment ?? adjustment);
    toast.success(
      actual > 0
        ? `Trainer reassigned · ${fmt.money(actual)} adjustment is due`
        : actual < 0
          ? `Trainer reassigned · ${fmt.money(Math.abs(actual))} credited`
          : 'Trainer reassigned · no price adjustment'
    );
    setTrainerId(null);
    setReason('');
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign trainer</DialogTitle>
          <DialogDescription>
            The service keeps its expiry. Only the remaining days are repriced.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>New trainer</Label>
            <Select value={trainerId} onValueChange={setTrainerId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a trainer" />
              </SelectTrigger>
              <SelectContent>
                {available.map((trainer) => {
                  const trainerRate = rates.find(
                    (candidate) => candidate.trainer_id === trainer.id
                  );
                  return (
                    <SelectItem key={trainer.id} value={trainer.id}>
                      {trainer.display_name}
                      {trainer.title ? ` · ${trainer.title}` : ''} ·{' '}
                      {fmt.money(trainerRate?.price ?? 0)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Switch date</Label>
            <DatePicker
              value={switchDate}
              onChange={setSwitchDate}
              min={service?.start_date}
              max={service?.end_date}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Required for assignment history"
            />
          </div>
          {trainerId ? (
            <div className="rounded-lg border px-3 py-2 text-sm">
              <div className="flex justify-between gap-3">
                <span>Prorated adjustment</span>
                <span className="font-medium tabular-nums">
                  {adjustment > 0 ? '+' : adjustment < 0 ? '−' : ''}
                  {fmt.money(Math.abs(adjustment))}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                ({fmt.money(rate?.price ?? 0)} −{' '}
                {fmt.money(
                  service?.assigned_full_rate ?? service?.sold_amount ?? 0
                )}
                ) × {remainingDays}/{totalDays} remaining days
              </p>
            </div>
          ) : null}
        </div>
        <DialogFooter showCloseButton>
          <Button
            onClick={reassign}
            disabled={saving || !trainerId || !reason.trim()}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Reassign trainer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
