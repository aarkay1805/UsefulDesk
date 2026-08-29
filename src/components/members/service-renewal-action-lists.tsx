'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarClock,
  CircleAlert,
  MessageCircle,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { useLocale } from '@/hooks/use-locale';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { istAddDays } from '@/lib/memberships/expiry';
import { TEMPLATE_CONTRACTS } from '@/lib/whatsapp/template-contracts';
import { evaluateTemplateReadiness } from '@/lib/whatsapp/template-readiness';
import type { Contact, MemberService, Membership } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Toolbar,
  ToolbarToggleGroup,
  ToolbarToggleItem,
} from '@/components/ui/toolbar';
import { FollowUpButton } from '@/components/follow-ups/follow-up-button';
import { FollowUpDialog } from '@/components/follow-ups/follow-up-dialog';
import { TableSkeleton } from '@/components/table/table-skeleton';
import { ProductServiceSaleDialog } from './product-service-sale-dialog';

type ServiceQueueRow = Omit<MemberService, 'contact_id'> & {
  contact_id: string;
  member_name: string | null;
  phone: string | null;
  days_until_expiry: number;
};
type Bucket = 'expiring' | 'expired';
const WINDOWS = {
  expiring: [
    { value: '7', label: 'Next 7 days', days: 7 },
    { value: '30', label: 'Next 30 days', days: 30 },
    { value: '90', label: 'Next 3 months', days: 90 },
  ],
  expired: [
    { value: '30', label: 'Last 30 days', days: 30 },
    { value: '90', label: 'Last 3 months', days: 90 },
    { value: 'all', label: 'All time', days: null },
  ],
} as const;
const SERVICE_TEMPLATE = TEMPLATE_CONTRACTS.service_renewal.payload.name;

export function serviceCustomerTarget(
  row: Pick<ServiceQueueRow, 'contact_id' | 'membership_id'>
) {
  return {
    contactId: row.contact_id,
    membershipId: row.membership_id ?? null,
  };
}

export function buildServiceRenewalParams(
  row: Pick<
    ServiceQueueRow,
    'member_name' | 'item_name_snapshot' | 'end_date' | 'current_renewal_price'
  >,
  fmt: {
    date: (value: string) => string;
    money: (value: number) => string;
  }
): string[] {
  return [
    row.member_name?.trim() || 'there',
    row.item_name_snapshot,
    fmt.date(row.end_date),
    fmt.money(row.current_renewal_price ?? 0),
  ];
}

export function ServiceRenewalActionLists({
  onSelect,
  reloadKey,
  canAct,
  sourceControl,
}: {
  onSelect: (customer: {
    contactId: string;
    membershipId: string | null;
  }) => void;
  reloadKey: number;
  canAct: boolean;
  sourceControl: ReactNode;
}) {
  const { fmt } = useLocale();
  const { accountId } = useAuth();
  const [rows, setRows] = useState<ServiceQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState<Bucket>('expiring');
  const [windowValue, setWindowValue] = useState('7');
  const [actionMembership, setActionMembership] = useState<Membership | null>(
    null
  );
  const [actionContact, setActionContact] = useState<Contact | null>(null);
  const [action, setAction] = useState<'renew' | 'followup' | null>(null);
  const [actionService, setActionService] = useState<ServiceQueueRow | null>(
    null
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data, error } = await createClient()
        .from('service_renewal_queue')
        .select('*')
        .order('end_date');
      if (cancelled) return;
      if (error) toast.error(error.message);
      setRows((data as ServiceQueueRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce]);

  const today = fmt.today();
  const expiring = rows.filter((row) => row.end_date >= today);
  const expired = rows.filter((row) => row.end_date < today);
  const filtered = useMemo(() => {
    const source = bucket === 'expiring' ? expiring : expired;
    const option = WINDOWS[bucket].find((item) => item.value === windowValue);
    if (!option || option.days === null) return source;
    const cutoff = istAddDays(
      today,
      bucket === 'expiring' ? option.days : -option.days
    );
    return source.filter((row) =>
      bucket === 'expiring' ? row.end_date <= cutoff : row.end_date >= cutoff
    );
  }, [bucket, expired, expiring, today, windowValue]);

  async function openAction(row: ServiceQueueRow, next: 'renew' | 'followup') {
    setPendingAction(`${row.id}:${next}`);
    try {
      const supabase = createClient();
      const [contactResult, membershipResult] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', row.contact_id).single(),
        row.membership_id
          ? supabase
              .from('memberships')
              .select(
                '*, contact:contacts(*), plan:membership_plans(*), pricing_option:plan_pricing_options(*)'
              )
              .eq('id', row.membership_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      const error = contactResult.error ?? membershipResult.error;
      if (error) return toast.error(error.message);
      setActionContact(contactResult.data as Contact);
      setActionMembership((membershipResult.data as Membership | null) ?? null);
      setActionService(row);
      setAction(next);
    } finally {
      setPendingAction(null);
    }
  }

  async function remind(row: ServiceQueueRow) {
    if (!row.phone)
      return toast.error('Add a phone number before sending a reminder');
    if (row.current_renewal_price == null) {
      return toast.error(
        'Configure the current trainer rate before sending a renewal reminder'
      );
    }
    setPendingAction(`${row.id}:remind`);
    try {
      if (!accountId) return toast.error('Account is still loading');
      const supabase = createClient();
      const [{ data: config }, { data: template }] = await Promise.all([
        supabase
          .from('whatsapp_config')
          .select('status')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .eq('name', SERVICE_TEMPLATE)
          .eq('language', 'en_US')
          .maybeSingle(),
      ]);
      if (config?.status !== 'connected')
        return toast.error('Connect WhatsApp in Settings first');
      const readiness = evaluateTemplateReadiness(
        template ? [template] : [],
        'service_renewal',
        'en_US'
      );
      if (!readiness.ready) return toast.error(readiness.message);
      const params = buildServiceRenewalParams(row, fmt);
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contact_id: row.contact_id,
          message_type: 'template',
          template_name: SERVICE_TEMPLATE,
          template_language: readiness.row.language ?? 'en_US',
          template_message_params: { body: params },
          template_params: params,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        return toast.error(result.error || 'Failed to send reminder');
      toast.success('Service renewal reminder sent');
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex flex-wrap items-center gap-2 border-b p-2">
          {sourceControl}
          <Toolbar aria-label="Service renewal status">
            <ToolbarToggleGroup<Bucket>
              value={[bucket]}
              onValueChange={(values) => {
                const next = values[0];
                if (next) {
                  setBucket(next);
                  setWindowValue(next === 'expiring' ? '7' : 'all');
                }
              }}
            >
              <ToolbarToggleItem value="expiring">
                <CalendarClock className="size-4" />
                Expiring{' '}
                <Badge variant="neutral" size="count">
                  {expiring.length}
                </Badge>
              </ToolbarToggleItem>
              <ToolbarToggleItem value="expired">
                <CircleAlert className="size-4" />
                Expired{' '}
                <Badge variant="neutral" size="count">
                  {expired.length}
                </Badge>
              </ToolbarToggleItem>
            </ToolbarToggleGroup>
          </Toolbar>
          <Select
            key={bucket}
            value={windowValue}
            onValueChange={(value) => value && setWindowValue(value)}
          >
            <SelectTrigger size="sm" className="ml-auto w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {WINDOWS[bucket].map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {loading ? (
          <div className="overflow-x-auto">
            <TableSkeleton
              className="min-w-[940px]"
              label="Loading service renewals"
              rows={7}
              columns={[
                { label: 'Name', variant: 'identity' },
                { label: 'Service' },
                { label: 'Trainer' },
                { label: 'Expiry' },
                { label: 'Status', variant: 'badge' },
                { label: 'Price' },
                {
                  label: 'Actions',
                  variant: 'actions',
                  headClassName: 'text-right',
                },
              ]}
            />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            No services in this window.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[940px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Trainer</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(serviceCustomerTarget(row))}
                  >
                    <TableCell>
                      <p className="font-medium">
                        {row.member_name || 'Member'}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {row.phone ? fmt.phone(row.phone) : 'No phone'}
                      </p>
                    </TableCell>
                    <TableCell>{row.item_name_snapshot}</TableCell>
                    <TableCell>{row.trainer_name || '—'}</TableCell>
                    <TableCell>{fmt.date(row.end_date)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={bucket === 'expiring' ? 'warning' : 'danger'}
                      >
                        {bucket === 'expiring'
                          ? `${row.days_until_expiry}d left`
                          : `${Math.abs(row.days_until_expiry)}d ago`}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.current_renewal_price == null ? (
                        <span className="text-amber-foreground text-xs">
                          Trainer fee not set
                        </span>
                      ) : (
                        fmt.money(row.current_renewal_price)
                      )}
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <FollowUpButton
                          loading={pendingAction === `${row.id}:followup`}
                          canAct={canAct}
                          disabled={pendingAction !== null}
                          onClick={() => void openAction(row, 'followup')}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={
                            !canAct ||
                            row.current_renewal_price == null ||
                            pendingAction !== null
                          }
                          loading={pendingAction === `${row.id}:renew`}
                          onClick={() => void openAction(row, 'renew')}
                        >
                          <RefreshCw className="size-3.5" />
                          Renew
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canAct || pendingAction !== null}
                          loading={pendingAction === `${row.id}:remind`}
                          onClick={() => void remind(row)}
                        >
                          <MessageCircle className="size-3.5" />
                          Remind
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {actionContact && action === 'renew' ? (
        <ProductServiceSaleDialog
          key={`${actionContact.id}:${actionService?.id ?? ''}`}
          open
          onOpenChange={(open) => {
            if (!open) {
              setAction(null);
              setActionContact(null);
              setActionMembership(null);
              setActionService(null);
            }
          }}
          contact={actionContact}
          membership={actionMembership}
          mode="service_renewal"
          initialSelections={
            actionService?.catalog_item_id && actionService.catalog_option_id
              ? [
                  {
                    item_id: actionService.catalog_item_id,
                    option_id: actionService.catalog_option_id,
                    trainer_id: actionService.trainer_id,
                    quantity: 1,
                    start_date: actionService.end_date,
                    renewed_from_service_id: actionService.id,
                    unit_amount: Number(actionService.current_renewal_price),
                  },
                ]
              : []
          }
          onSaved={() => setNonce((value) => value + 1)}
        />
      ) : null}
      {actionContact && action === 'followup' ? (
        actionMembership ? (
          <FollowUpDialog
            open
            onOpenChange={(open) => {
              if (!open) {
                setAction(null);
                setActionContact(null);
                setActionMembership(null);
                setActionService(null);
              }
            }}
            membership={actionMembership}
            onSaved={() => setNonce((value) => value + 1)}
          />
        ) : (
          <FollowUpDialog
            open
            onOpenChange={(open) => {
              if (!open) {
                setAction(null);
                setActionContact(null);
                setActionService(null);
              }
            }}
            contactId={actionContact.id}
            contactName={actionContact.name}
            onSaved={() => setNonce((value) => value + 1)}
          />
        )
      ) : null}
    </>
  );
}
