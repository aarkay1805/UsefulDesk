'use client';

import { forwardRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocale } from '@/hooks/use-locale';
import { getErrorMessage } from '@/lib/errors';
import { timeInTzToUtc } from '@/lib/locale/format';
import {
  REMINDER_RULES,
  type ReminderRuleId,
  type ReminderRulePatch,
} from '@/lib/reminders/rules';
import { SettingsSectionHead } from './settings-panel-head';

export type LifecycleSendingHours = {
  start: number;
  end: number;
};

export type LifecycleSendingHoursDraft = {
  start?: number;
  end?: number;
};

export const LIFECYCLE_SENDING_HOURS_RULE_IDS = [
  'invoice_collection',
  'membership_post_expiry',
  'service_post_expiry',
  'promise_to_pay',
  'payment_link_follow_up',
  'session_pack',
  'freeze_return',
  'membership_win_back',
  'service_win_back',
] as const satisfies readonly ReminderRuleId[];

const LIFECYCLE_MESSAGE_TYPES = LIFECYCLE_SENDING_HOURS_RULE_IDS.map(
  (id) => REMINDER_RULES.find((rule) => rule.id === id)!.title
);

type LifecycleSendingHoursSettingsProps = {
  scopeKey: string;
  value: LifecycleSendingHours;
  draft: LifecycleSendingHoursDraft;
  canEdit: boolean;
  onDraftChange: (draft: LifecycleSendingHoursDraft) => void;
  onSave: (patch: ReminderRulePatch) => Promise<void>;
};

export const LifecycleSendingHoursSettings = forwardRef<
  HTMLElement,
  LifecycleSendingHoursSettingsProps
>(function LifecycleSendingHoursSettings(
  { scopeKey, value, draft, canEdit, onDraftChange, onSave },
  ref
) {
  const { fmt, locale } = useLocale();
  const [savingScope, setSavingScope] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const start = draft.start ?? value.start;
  const end = draft.end ?? value.end;
  const dirty = draft.start !== undefined || draft.end !== undefined;
  const saving = savingScope === scopeKey;
  const error = errors[scopeKey];
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const localTime = (hour: number, minute = '00') => {
    const instant = timeInTzToUtc(
      fmt.today(),
      `${String(hour).padStart(2, '0')}:${minute}`,
      locale.timeZone
    );
    return instant ? fmt.time(instant) : '—';
  };
  const changeDraft = (next: LifecycleSendingHoursDraft) => {
    setErrors((current) => ({ ...current, [scopeKey]: undefined }));
    onDraftChange(next);
  };
  const cancel = () => {
    setErrors((current) => ({ ...current, [scopeKey]: undefined }));
    onDraftChange({});
  };
  const save = async () => {
    if (!dirty) return;
    const requestScope = scopeKey;
    setSavingScope(requestScope);
    setErrors((current) => ({ ...current, [requestScope]: undefined }));
    try {
      await onSave({ sendWindowStart: start, sendWindowEnd: end });
      onDraftChange({});
    } catch (saveError) {
      setErrors((current) => ({
        ...current,
        [requestScope]: getErrorMessage(
          saveError,
          'Sending hours couldn’t be saved. Try again.'
        ),
      }));
    } finally {
      setSavingScope((current) => (current === requestScope ? null : current));
    }
  };

  return (
    <section
      ref={ref}
      aria-labelledby="lifecycle-sending-hours-title"
      className="scroll-mt-4 space-y-3"
      data-testid="lifecycle-sending-hours"
      tabIndex={-1}
    >
      <SettingsSectionHead
        id="lifecycle-sending-hours-title"
        title="Sending hours"
        description="Choose when the messages listed below can be sent."
      />
      <Card>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium">
              Messages that share these sending hours
            </div>
            <ul className="text-muted-foreground grid list-disc gap-x-8 gap-y-1 pl-5 text-sm sm:grid-cols-2">
              {LIFECYCLE_MESSAGE_TYPES.map((messageType) => (
                <li key={messageType}>{messageType}</li>
              ))}
            </ul>
          </div>

          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lifecycle-send-window-start">
                Start sending at
              </Label>
              <Select
                value={String(start)}
                onValueChange={(next) => {
                  if (next == null) return;
                  changeDraft({ ...draft, start: Number(next) });
                }}
                disabled={!canEdit || saving}
              >
                <SelectTrigger
                  id="lifecycle-send-window-start"
                  className="w-full"
                  aria-label="Start sending at"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hours
                    .filter((hour) => hour <= end)
                    .map((hour) => (
                      <SelectItem key={hour} value={String(hour)}>
                        {localTime(hour)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lifecycle-send-window-end">
                Stop sending after
              </Label>
              <Select
                value={String(end)}
                onValueChange={(next) => {
                  if (next == null) return;
                  changeDraft({ ...draft, end: Number(next) });
                }}
                disabled={!canEdit || saving}
              >
                <SelectTrigger
                  id="lifecycle-send-window-end"
                  className="w-full"
                  aria-label="Stop sending after"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hours
                    .filter((hour) => hour >= start)
                    .map((hour) => (
                      <SelectItem key={hour} value={String(hour)}>
                        {localTime(hour, '59')}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-muted-foreground max-w-3xl space-y-1 text-sm leading-5">
            <p>
              Membership renewal, service renewal, and installment reminders
              still start after {localTime(9)}. They do not use these sending
              hours.
            </p>
            <p>
              Payment confirmations and AutoPay updates send when the payment
              status changes. They do not use these sending hours.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Sending hours weren’t saved</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        {dirty ? (
          <CardFooter className="gap-2">
            <span
              className="text-amber-foreground mr-auto text-sm"
              role="status"
            >
              Unsaved changes
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={cancel}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={saving}
              disabled={!canEdit}
              onClick={save}
            >
              Save changes
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
});
