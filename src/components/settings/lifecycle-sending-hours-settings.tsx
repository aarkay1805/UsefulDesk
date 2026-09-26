'use client';

import { forwardRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
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
  const dirty = start !== value.start || end !== value.end;
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
    onDraftChange({
      ...(next.start !== undefined && next.start !== value.start
        ? { start: next.start }
        : {}),
      ...(next.end !== undefined && next.end !== value.end
        ? { end: next.end }
        : {}),
    });
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
      />
      <Card size="sm">
        <CardContent className="space-y-3">
          {/* One sentence with the hours inline, so the section stays a
              single line and the messages below start above the fold. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
            <span>Send follow-up and payment messages between</span>
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
                size="sm"
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
            <span>and</span>
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
                size="sm"
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
            <Popover>
              <PopoverTrigger
                render={
                  // -ml-2.5 lines the label up with the sentence when it
                  // wraps; from sm it sits at the card's right edge.
                  <Button
                    variant="link"
                    size="sm"
                    className="-ml-2.5 sm:ml-auto"
                  />
                }
              >
                Which messages?
              </PopoverTrigger>
              <PopoverContent
                align="end"
                aria-label="Which messages follow Sending hours"
                className="w-80 max-w-[calc(100vw-2rem)] gap-3"
              >
                <div className="space-y-1.5">
                  <div className="text-foreground font-medium">
                    Sent only in these hours
                  </div>
                  <ul className="text-muted-foreground list-disc space-y-0.5 pl-5">
                    {LIFECYCLE_MESSAGE_TYPES.map((messageType) => (
                      <li key={messageType}>{messageType}</li>
                    ))}
                  </ul>
                </div>
                <Separator />
                <div className="space-y-1.5">
                  <div className="text-foreground font-medium">
                    Sent on their own timing
                  </div>
                  <div className="text-muted-foreground space-y-1">
                    <div>
                      Membership, service, and installment reminders start after{' '}
                      {localTime(9)}.
                    </div>
                    <div>
                      Payment confirmations and AutoPay updates send as soon as
                      the payment changes.
                    </div>
                    <div>
                      Missed gym visits sends one hour after the member’s
                      assigned arrival, or at {localTime(end, '30')} if none is
                      set.
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
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
