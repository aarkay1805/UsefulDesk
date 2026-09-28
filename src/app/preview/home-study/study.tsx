'use client';

import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { DashboardActionsProvider } from '@/components/dashboard/dashboard-actions';
import { GymMetrics } from '@/components/dashboard/gym-metrics';
import { QuickActions } from '@/components/dashboard/quick-actions';
import {
  DashboardSection,
  DASHBOARD_PAIRED_SECTION,
  DASHBOARD_QUEUE_SCROLLER,
} from '@/components/dashboard/dashboard-section';
import {
  QUEUE_LIST,
  QUEUE_SCROLL_INSET,
  QueueCount,
  QueueEmpty,
} from '@/components/dashboard/action-queue';
import { FollowUpTaskLine } from '@/components/follow-ups/follow-up-task-summary';
import { MemberIdentity } from '@/components/members/member-identity';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Chip, ChipCount, ChipGroup } from '@/components/ui/chip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useLocale } from '@/hooks/use-locale';
import { followUpDueState } from '@/lib/follow-ups/due-state';
import type { DashboardActionSnapshot } from '@/lib/dashboard/action-snapshot';
import {
  BASELINE,
  STUDY_TODAY,
  FOLLOW_UPS,
  RENEWALS,
  ENQUIRIES,
  collectibleStudyFees,
  studyFollowUps,
  type StudyOptions,
  type StudyBucket,
} from './fixtures';

type Queue = 'followups' | 'renewals' | 'enquiries' | 'fees';
type Action = { label: string; id: string; name: string };
const TITLES: Record<Queue, string> = {
  followups: 'Follow-ups',
  renewals: 'Expiring memberships',
  enquiries: 'Not contacted yet',
  fees: 'Fees to collect',
};
const FEE_SCOPE =
  'Unpaid membership fees, including older invoices. Services and products are separate.';
const CHOICES: {
  key: keyof StudyOptions;
  label: string;
  options: [string, string][];
}[] = [
  {
    key: 'followUps',
    label: 'Follow-up preview',
    options: [
      ['all', 'All open'],
      ['due', 'Overdue and due today'],
    ],
  },
  {
    key: 'preview',
    label: 'Preview length',
    options: [
      ['scroll', 'Eight rows with scrolling'],
      ['short', 'Three rows without scrolling'],
    ],
  },
  {
    key: 'fees',
    label: 'Fee preview',
    options: [
      ['hidden', 'First-fold link only'],
      ['shown', 'Also show a fee preview'],
    ],
  },
  {
    key: 'order',
    label: 'Section order',
    options: [
      ['renewals', 'Renewals before new enquiries'],
      ['enquiries', 'New enquiries before renewals'],
    ],
  },
  {
    key: 'actions',
    label: 'Row actions',
    options: [
      ['details', 'Open details first'],
      ['labelled', 'Show action labels'],
    ],
  },
];

export function HomeStudy({
  initialOptions = BASELINE,
}: {
  initialOptions?: StudyOptions;
}) {
  const { fmt } = useLocale();
  const [options, setOptions] = useState(initialOptions);
  const [run, setRun] = useState(0);
  const [bucket, setBucket] = useState<StudyBucket>(initialOptions.followUps);
  const [scope, setScope] = useState('all');
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [paid, setPaid] = useState<Set<string>>(new Set());
  const [renewed, setRenewed] = useState<Set<string>>(new Set());
  const [contacted, setContacted] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action | null>(null);
  const [openedQueue, setOpenedQueue] = useState<Queue | null>(null);
  const [notice, setNotice] = useState('');
  const fees = collectibleStudyFees(paid);
  const followUps = studyFollowUps(bucket, completed).filter(
    (row) => scope === 'all' || row.kind === scope
  );
  const renewals = RENEWALS.filter((row) => !renewed.has(row.id));
  const enquiries = ENQUIRIES.filter((row) => !contacted.has(row.id));
  const totalFees = fees.reduce((sum, row) => sum + row.balance, 0);

  const snapshot: DashboardActionSnapshot = {
    today: STUDY_TODAY,
    gymMetrics: {
      expiring7: renewals.length,
      feesDueCount: fees.length,
      feesDueAmount: totalFees,
      collectedToday: 6000 + (4000 - totalFees),
      collectionDailyAverage7d: 5000,
      missedVisitRisk: 2,
      neverVisitedRisk: 1,
    },
    followUps: null,
    expiringMemberships: null,
    uncontactedLeads: null,
    attention: null,
    errors: [],
  };

  function reset(next = options) {
    setRun((value) => value + 1);
    setOptions(next);
    setBucket(next.followUps);
    setScope('all');
    setCompleted(new Set());
    setPaid(new Set());
    setRenewed(new Set());
    setContacted(new Set());
    setOpenedQueue(null);
    setAction(null);
    setNotice('');
  }
  function act(label: string, id: string, name: string) {
    setOpenedQueue(null);
    setAction({ label, id, name });
  }
  function confirm() {
    if (!action) return;
    if (action.label === 'Record payment')
      setPaid((old) => new Set([...old, action.id]));
    if (action.label === 'Renew')
      setRenewed((old) => new Set([...old, action.id]));
    if (action.label === 'Mark done')
      setCompleted((old) => new Set([...old, action.id]));
    if (action.label === 'Chat' || action.label === 'Call')
      setContacted((old) => new Set([...old, action.id]));
    setNotice(
      `${action.label === 'Send reminder' ? 'Reminder sent' : action.label === 'Record payment' ? 'Payment recorded' : action.label === 'Renew' ? 'Membership renewed' : action.label === 'Mark done' ? 'Follow-up completed' : action.label === 'Call' ? 'Call completed' : 'Message sent'}: ${action.name} (practice).`
    );
    setAction(null);
  }
  function controls(id: string, name: string, labels: string[]) {
    return (
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {(options.actions === 'labelled' ? labels : ['Details']).map(
          (label) => (
            <Button
              key={label}
              variant="ghost"
              size="sm"
              aria-label={`${label} for ${name}`}
              onClick={() => act(label, id, name)}
            >
              {label}
            </Button>
          )
        )}
      </div>
    );
  }
  function list(queue: Queue, full = false) {
    const limit = full
      ? Number.POSITIVE_INFINITY
      : options.preview === 'short'
        ? 3
        : 8;
    const rows =
      queue === 'followups'
        ? followUps
        : queue === 'renewals'
          ? renewals
          : queue === 'enquiries'
            ? enquiries
            : fees;
    if (!rows.length)
      return (
        <QueueEmpty
          icon={ClipboardCheck}
          text="No work in this list. Choose another list."
        />
      );
    return (
      <ul className={QUEUE_LIST}>
        {rows.slice(0, limit).map((row) => {
          const due =
            'due' in row && typeof row.due === 'string'
              ? followUpDueState('open', row.due, STUDY_TODAY)
              : null;
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-2 py-2"
            >
              <div className="min-w-0 grow basis-48">
                <MemberIdentity
                  name={row.name}
                  meta={
                    queue === 'followups' && 'note' in row ? (
                      <FollowUpTaskLine taskType="call" note={row.note} />
                    ) : 'expiry' in row && typeof row.expiry === 'string' ? (
                      `Expires on ${fmt.date(row.expiry)}`
                    ) : 'balance' in row ? (
                      <span className="tabular-nums">
                        {fmt.money(row.balance)} due · {row.invoice} ·{' '}
                        {fmt.dateShort(row.period)}
                      </span>
                    ) : 'note' in row ? (
                      row.note
                    ) : undefined
                  }
                />
              </div>
              {queue === 'followups' &&
                'due' in row &&
                typeof row.due === 'string' &&
                (due ? (
                  <Badge variant={due.variant}>{due.label}</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {fmt.date(row.due)}
                  </span>
                ))}
              {controls(
                row.id,
                row.name,
                queue === 'followups'
                  ? ['Call', 'Chat', 'Mark done']
                  : queue === 'renewals'
                    ? ['Send reminder', 'Renew']
                    : queue === 'fees'
                      ? ['Record payment']
                      : ['Call', 'Chat']
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  function section(queue: Queue) {
    const total =
      queue === 'followups'
        ? followUps.length
        : queue === 'renewals'
          ? renewals.length
          : queue === 'enquiries'
            ? enquiries.length
            : fees.length;
    const inset = total ? QUEUE_SCROLL_INSET : '';
    const content = <CardContent>{list(queue)}</CardContent>;
    return (
      <DashboardSection
        key={`${queue}:${run}`}
        id={`study-${queue}`}
        title={TITLES[queue]}
        className={
          options.preview === 'scroll' ? DASHBOARD_PAIRED_SECTION : undefined
        }
        action={
          <div className="flex items-center gap-2">
            <QueueCount
              shown={Math.min(total, options.preview === 'short' ? 3 : 8)}
              total={total}
            />
            <Button
              variant="link"
              size="xs"
              onClick={() => setOpenedQueue(queue)}
              aria-label={`See all ${TITLES[queue].toLowerCase()}`}
            >
              See all
            </Button>
          </div>
        }
      >
        <Card className="min-h-0 flex-1">
          {queue === 'followups' && (
            <CardHeader>
              <div className="min-w-0 space-y-3">
                <ChipGroup
                  selectionMode="single"
                  value={[scope]}
                  onValueChange={(values) => values[0] && setScope(values[0])}
                  aria-label="Show follow-ups for"
                >
                  {[
                    ['all', 'All'],
                    ['lead', 'Enquiries'],
                    ['member', 'Members'],
                  ].map(([value, label]) => (
                    <Chip key={value} value={value}>
                      {label}
                    </Chip>
                  ))}
                </ChipGroup>
                <ChipGroup<StudyBucket>
                  selectionMode="single"
                  value={[bucket]}
                  onValueChange={(values) => values[0] && setBucket(values[0])}
                  aria-label="Follow-up due dates"
                >
                  {(
                    [
                      ['all', 'All open'],
                      ['due', 'Overdue and due today'],
                      ['upcoming', 'Upcoming'],
                    ] as const
                  ).map(([value, label]) => (
                    <Chip key={value} value={value}>
                      {label}
                      <ChipCount
                        count={
                          studyFollowUps(value, completed).filter(
                            (row) => scope === 'all' || row.kind === scope
                          ).length
                        }
                      />
                    </Chip>
                  ))}
                </ChipGroup>
              </div>
            </CardHeader>
          )}
          {queue === 'fees' && (
            <CardHeader>
              <div className="text-muted-foreground text-xs">{FEE_SCOPE}</div>
            </CardHeader>
          )}
          {options.preview === 'scroll' ? (
            <ScrollArea className={`${DASHBOARD_QUEUE_SCROLLER} ${inset}`}>
              {content}
            </ScrollArea>
          ) : (
            content
          )}
        </Card>
      </DashboardSection>
    );
  }
  const person = action ? FOLLOW_UPS.find((row) => row.id === action.id) : null;
  const fee = action ? fees.find((row) => row.id === action.id) : null;
  const renewal = action ? renewals.find((row) => row.id === action.id) : null;
  const followUp = person && !completed.has(person.id);
  const detailActions = action
    ? [
        ...(followUp
          ? ['Call', 'Chat', 'Mark done']
          : enquiries.some((row) => row.id === action.id)
            ? ['Call', 'Chat']
            : []),
        ...(renewal ? ['Send reminder', 'Renew'] : []),
        ...(fee ? ['Record payment'] : []),
      ]
    : [];

  return (
    <main className="bg-background min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="space-y-3">
          <h1 className="text-xl font-semibold">Home · Practice gym</h1>
          <Alert>
            <AlertDescription>
              Fictional people and money. All actions are practice only. Today
              is {fmt.date(STUDY_TODAY)}.
            </AlertDescription>
          </Alert>
          <Accordion>
            <AccordionItem value="review">
              <AccordionTrigger>Study controls</AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {CHOICES.map((choice) => (
                    <div key={choice.key} className="space-y-2">
                      <Label htmlFor={`option-${choice.key}`}>
                        {choice.label}
                      </Label>
                      <Select
                        value={options[choice.key]}
                        onValueChange={(value) =>
                          value && reset({ ...options, [choice.key]: value })
                        }
                      >
                        <SelectTrigger
                          id={`option-${choice.key}`}
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {choice.options.map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => reset()}>
                    Reset practice
                  </Button>
                  <Button variant="outline" onClick={() => reset(BASELINE)}>
                    Load baseline
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        {/* The unchanged first-fold masters stay identical in every comparison.
          Intercept their links so a study can never open a real customer flow. */}
        <div
          className="space-y-8"
          onClickCapture={(event) => {
            const link = (event.target as Element).closest('a');
            if (!link) return;
            event.preventDefault();
            event.stopPropagation();
            if (
              link.getAttribute('href')?.startsWith('/members?') &&
              link.getAttribute('href')?.includes('view=payments')
            )
              setOpenedQueue('fees');
            else if (link.getAttribute('href')?.includes('view=renewals'))
              setOpenedQueue('renewals');
            else
              setNotice(
                `${link.textContent?.trim() || 'Action'} is outside this practice session.`
              );
          }}
        >
          <DashboardActionsProvider
            key={`${totalFees}:${renewals.length}`}
            initialSnapshot={snapshot}
            autoLoad={false}
          >
            <GymMetrics />
          </DashboardActionsProvider>
          <QuickActions />
        </div>
        <div
          role="status"
          aria-live="polite"
          className="text-muted-foreground text-sm"
        >
          {notice}
        </div>
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-8 lg:grid-cols-2">
          {section('followups')}
          {section(options.order === 'renewals' ? 'renewals' : 'enquiries')}
          {section(options.order === 'renewals' ? 'enquiries' : 'renewals')}
          <DashboardSection id="study-attention" title="Needs attention">
            <Card>
              <CardContent>
                <QueueEmpty
                  icon={ClipboardCheck}
                  text="Nothing needs your attention right now."
                />
              </CardContent>
            </Card>
          </DashboardSection>
          {options.fees === 'shown' && section('fees')}
        </div>
        <Dialog
          open={openedQueue !== null}
          onOpenChange={(open) => !open && setOpenedQueue(null)}
        >
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {openedQueue ? TITLES[openedQueue] : ''}
              </DialogTitle>
              <DialogDescription>
                {openedQueue === 'fees'
                  ? FEE_SCOPE
                  : 'All people in the selected practice list.'}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[60vh]">
              {openedQueue && list(openedQueue, true)}
            </ScrollArea>
          </DialogContent>
        </Dialog>
        <Dialog
          open={action !== null}
          onOpenChange={(open) => !open && setAction(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {action?.label === 'Details'
                  ? action.name
                  : `${action?.label ?? ''} · ${action?.name ?? ''}`}
              </DialogTitle>
              <DialogDescription>
                Practice only. No real messages, calls, or payments.
              </DialogDescription>
            </DialogHeader>
            {action?.label === 'Details' ? (
              <div className="space-y-3">
                {person && (
                  <div>
                    <FollowUpTaskLine taskType="call" note={person.note} />
                    Due {fmt.date(person.due)} ·{' '}
                    {followUp ? 'Open' : 'Completed'}
                  </div>
                )}
                {renewal && <div>Expires on {fmt.date(renewal.expiry)}</div>}
                {fee && (
                  <div className="tabular-nums">
                    {fmt.money(fee.balance)} due · {fee.invoice} ·{' '}
                    {fmt.dateShort(fee.period)}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {detailActions.map((label) => (
                    <Button
                      key={label}
                      variant="outline"
                      onClick={() => setAction({ ...action, label })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {action?.label === 'Record payment' && fee && (
                  <div className="tabular-nums">
                    {fmt.money(fee.balance)} · {fee.invoice} · Membership fee
                  </div>
                )}
                {action?.label === 'Renew' && (
                  <div>
                    Start the next monthly membership. Collect payment
                    separately.
                  </div>
                )}
                {action?.label === 'Chat' && (
                  <div>Message: Hello, calling about your gym enquiry.</div>
                )}
                <DialogFooter>
                  <Button onClick={confirm}>{action?.label}</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
