'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableSkeleton } from '@/components/table/table-skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Users,
  Send,
  CheckCheck,
  Eye,
  AlertCircle,
  MessageCircle,
  Filter,
  Download,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { getBroadcastStatus, getRecipientStatus } from '@/lib/broadcast-status';
import { usePendingNavigation } from '@/hooks/use-pending-navigation';
import { useLocale } from '@/hooks/use-locale';
import { downloadCsv, toCsv } from '@/lib/csv/export';
import {
  boundedRecipientPage,
  RECIPIENT_EXPORT_PAGE_SIZE,
  RECIPIENT_PAGE_SIZE,
  recipientCursorFilter,
  recipientStatusQuery,
  type RecipientCursor,
  walkRecipientPages,
} from '@/lib/broadcasts/recipient-pagination';

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  icon: React.ReactNode;
  color: string;
  formatNumber: (value: number) => string;
}

function StatCard({
  label,
  value,
  total,
  icon,
  color,
  formatNumber,
}: StatCardProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}
        >
          {icon}
        </div>
        <span className="text-muted-foreground text-xs">{pct}%</span>
      </div>
      <p className="text-foreground mt-3 text-2xl font-bold">
        {formatNumber(value)}
      </p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

/**
 * Pure-CSS funnel chart: decreasing-width rounded bars.
 * Width is relative to the largest step (typically Sent) so we
 * always render a full bar at the top and proportional tails.
 */
function FunnelChart({
  steps,
  formatNumber,
}: {
  steps: FunnelStep[];
  formatNumber: (value: number) => string;
}) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <h3 className="text-foreground mb-4 text-sm font-medium">Funnel</h3>
      <div className="space-y-2">
        {steps.map((step) => {
          const pctOfMax = Math.max(5, Math.round((step.value / max) * 100));
          const pctOfSent =
            steps[0].value > 0
              ? Math.round((step.value / steps[0].value) * 100)
              : 0;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className="text-muted-foreground w-20 shrink-0 text-xs">
                {step.label}
              </span>
              <div className="bg-muted relative h-7 flex-1 rounded-full">
                <div
                  className={`h-7 rounded-full ${step.color} transition-[width] duration-500`}
                  style={{ width: `${pctOfMax}%` }}
                />
                <span className="text-foreground absolute inset-0 flex items-center px-3 text-xs font-medium">
                  {formatNumber(step.value)}
                  <span className="text-muted-foreground/80 ml-2">
                    ({pctOfSent}%)
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
];

export default function BroadcastDetailPage() {
  const { fmt } = useLocale();
  const params = useParams();
  const { navigate, isPending } = usePendingNavigation();
  const broadcastId = params.id as string;

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>(
    'all'
  );
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [loadingMoreRecipients, setLoadingMoreRecipients] = useState(false);
  const [nextRecipientCursor, setNextRecipientCursor] =
    useState<RecipientCursor | null>(null);
  const [recipientRequest, setRecipientRequest] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: bc, error: bcError } = await supabase
          .from('broadcasts')
          .select('*')
          .eq('id', broadcastId)
          .single();

        if (bcError) throw bcError;
        if (!cancelled) setBroadcast(bc);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Failed to load broadcast'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [broadcastId]);

  const fetchRecipientPage = useCallback(
    async (
      cursor: RecipientCursor | null,
      pageSize: number,
      filter: RecipientStatus | 'all' = statusFilter
    ) => {
      const supabase = createClient();
      let query = supabase
        .from('broadcast_recipients')
        .select(
          'id,broadcast_id,contact_id,status,sent_at,delivered_at,read_at,replied_at,error_message,whatsapp_message_id,created_at,contact:contacts(id,name,phone)',
          { count: 'exact' }
        )
        .eq('broadcast_id', broadcastId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      const recipientStatus = recipientStatusQuery(filter);
      if (recipientStatus) query = query.eq('status', recipientStatus);
      if (cursor) query = query.or(recipientCursorFilter(cursor));

      const { data, error: pageError, count } = await query.limit(pageSize + 1);
      const page = boundedRecipientPage(
        (data ?? []) as unknown as BroadcastRecipient[],
        pageSize
      );
      return { ...page, count, error: pageError };
    },
    [broadcastId, statusFilter]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setRecipientsLoading(true);
      setRecipientError(null);
      setRecipients([]);
      setRecipientCount(null);
      setNextRecipientCursor(null);

      const page = await fetchRecipientPage(null, RECIPIENT_PAGE_SIZE);
      if (cancelled) return;
      if (page.error) {
        setRecipientError(page.error.message);
      } else {
        setRecipients(page.rows);
        setRecipientCount(page.count ?? 0);
        setNextRecipientCursor(page.nextCursor);
      }
      setRecipientsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchRecipientPage, recipientRequest]);

  const loadMoreRecipients = useCallback(async () => {
    if (!nextRecipientCursor || loadingMoreRecipients) return;
    setLoadingMoreRecipients(true);
    const page = await fetchRecipientPage(
      nextRecipientCursor,
      RECIPIENT_PAGE_SIZE
    );
    if (page.error) {
      setRecipientError(page.error.message);
    } else {
      setRecipients((current) => [...current, ...page.rows]);
      setNextRecipientCursor(page.nextCursor);
    }
    setLoadingMoreRecipients(false);
  }, [fetchRecipientPage, loadingMoreRecipients, nextRecipientCursor]);

  async function handleExport() {
    if (!broadcast) return;
    setExporting(true);
    try {
      const allRecipients = await walkRecipientPages(async (cursor) => {
        const page = await fetchRecipientPage(
          cursor,
          RECIPIENT_EXPORT_PAGE_SIZE,
          'all'
        );
        if (page.error) throw page.error;
        return page;
      });
      const header = [
        'Contact',
        'Phone',
        'Status',
        'Sent At',
        'Delivered At',
        'Read At',
        'Replied At',
        'Error',
      ];
      const rows = allRecipients.map((r) => [
        r.contact?.name ?? '',
        fmt.phone(r.contact?.phone),
        r.status,
        r.sent_at ?? '',
        r.delivered_at ?? '',
        r.read_at ?? '',
        r.replied_at ?? '',
        r.error_message ?? '',
      ]);
      const safeName = broadcast.name
        .replace(/[^a-z0-9-_]+/gi, '-')
        .toLowerCase();
      downloadCsv(
        `broadcast-${safeName}-${broadcastId.slice(0, 8)}.csv`,
        toCsv(header, rows)
      );
    } catch (exportError) {
      const message =
        exportError instanceof Error
          ? exportError.message
          : 'Failed to export broadcast recipients';
      toast.error(message);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    // broadcast_recipients cascades on broadcasts.id (migration 001), so a
    // single delete is sufficient — the aggregate trigger in migration 003
    // is defined on broadcast_recipients but fires only on its own row
    // changes, not on a cascaded drop of the parent row.
    const { data: deleted, error: delErr } = await supabase
      .from('broadcasts')
      .delete()
      .eq('id', broadcastId)
      .select('id');
    if (delErr || !deleted?.length) {
      setDeleting(false);
      toast.error(
        `Failed to delete: ${delErr?.message ?? 'Broadcast was not found or access was denied'}`
      );
      return;
    }
    toast.success('Broadcast deleted');
    navigate('/broadcasts');
  }

  if (loading) {
    return (
      <div className="border-border bg-card overflow-hidden rounded-xl border">
        <TableSkeleton
          label="Loading broadcast recipients"
          rows={7}
          columns={[
            { label: 'Contact', variant: 'identity' },
            { label: 'Phone' },
            { label: 'Status', variant: 'badge' },
            { label: 'Sent' },
            { label: 'Delivered' },
            { label: 'Read' },
            { label: 'Error' },
          ]}
        />
      </div>
    );
  }

  if (error || !broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-red-foreground text-sm">
          {error ?? 'Broadcast not found'}
        </p>
        <Button
          variant="outline"
          onClick={() => navigate('/broadcasts')}
          loading={isPending('/broadcasts')}
        >
          Back to Broadcasts
        </Button>
      </div>
    );
  }

  const status = getBroadcastStatus(broadcast.status);

  const funnelSteps: FunnelStep[] = [
    { label: 'Sent', value: broadcast.sent_count, color: 'bg-primary' },
    {
      label: 'Delivered',
      value: broadcast.delivered_count,
      color: 'bg-teal-500',
    },
    { label: 'Read', value: broadcast.read_count, color: 'bg-blue-500' },
    {
      label: 'Replied',
      value: broadcast.replied_count,
      color: 'bg-indigo-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate('/broadcasts')}
            loading={isPending('/broadcasts')}
            className="border-border"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-foreground text-2xl font-bold">
                {broadcast.name}
              </h1>
              <Badge className={status.classes}>{status.label}</Badge>
            </div>
            <div className="text-muted-foreground mt-1 flex items-center gap-3 text-sm">
              <span>Template: {broadcast.template_name}</span>
              <span>-</span>
              <span>Created {fmt.date(broadcast.created_at)}</span>
            </div>
          </div>
        </div>

        {/* Delete — inline-confirm pattern matches the pipeline-settings
            "Delete Pipeline" flow. Mid-send broadcasts can't be deleted
            because orphaning in-flight Meta messages would leave the
            funnel inconsistent. */}
        {confirmDelete ? (
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
            <span className="text-red-foreground">Delete this broadcast?</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="border-border text-muted-foreground hover:bg-muted h-7 bg-transparent"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              loading={deleting}
              disabled={deleting}
              className="h-7"
            >
              {deleting ? 'Deleting…' : 'Confirm'}
            </Button>
          </div>
        ) : (
          <Button
            variant="destructive-ghost"
            size="sm"
            disabled={broadcast.status === 'sending'}
            onClick={() => setConfirmDelete(true)}
            title={
              broadcast.status === 'sending'
                ? 'Cannot delete while a broadcast is actively sending'
                : 'Delete this broadcast'
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        )}
      </div>

      {/* Stats — 6 cards: Total / Sent / Delivered / Read / Replied / Failed */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Total Recipients"
          value={broadcast.total_recipients}
          total={broadcast.total_recipients}
          icon={<Users className="h-4 w-4" />}
          color="bg-muted text-muted-foreground"
          formatNumber={fmt.number}
        />
        <StatCard
          label="Sent"
          value={broadcast.sent_count}
          total={broadcast.total_recipients}
          icon={<Send className="h-4 w-4" />}
          color="bg-primary/10 text-primary-text"
          formatNumber={fmt.number}
        />
        <StatCard
          label="Delivered"
          value={broadcast.delivered_count}
          total={broadcast.total_recipients}
          icon={<CheckCheck className="h-4 w-4" />}
          color="bg-teal-500/10 text-teal-foreground"
          formatNumber={fmt.number}
        />
        <StatCard
          label="Read"
          value={broadcast.read_count}
          total={broadcast.total_recipients}
          icon={<Eye className="h-4 w-4" />}
          color="bg-blue-500/10 text-blue-foreground"
          formatNumber={fmt.number}
        />
        <StatCard
          label="Replied"
          value={broadcast.replied_count}
          total={broadcast.total_recipients}
          icon={<MessageCircle className="h-4 w-4" />}
          color="bg-indigo-500/10 text-indigo-foreground"
          formatNumber={fmt.number}
        />
        <StatCard
          label="Failed"
          value={broadcast.failed_count}
          total={broadcast.total_recipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-red-500/10 text-red-foreground"
          formatNumber={fmt.number}
        />
      </div>

      <FunnelChart steps={funnelSteps} formatNumber={fmt.number} />

      {/* Recipients Table */}
      <div className="border-border bg-card rounded-xl border">
        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-foreground text-sm font-medium">
            Recipients
            {recipientCount !== null ? ` (${fmt.number(recipientCount)})` : ''}
          </h2>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="pill"
                    size="sm"
                    aria-pressed={statusFilter !== 'all'}
                  />
                }
              >
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === 'all'
                  ? 'All statuses'
                  : getRecipientStatus(statusFilter).label}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-border bg-popover">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all'
                      ? 'text-primary-text'
                      : 'text-popover-foreground'
                  }
                >
                  All statuses
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={
                      statusFilter === s
                        ? 'text-primary-text'
                        : 'text-popover-foreground'
                    }
                  >
                    {getRecipientStatus(s).label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              loading={exporting}
              disabled={recipientsLoading || broadcast.total_recipients === 0}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {recipientsLoading ? (
          <TableSkeleton
            label="Loading broadcast recipients"
            rows={7}
            columns={[
              { label: 'Contact', variant: 'identity' },
              { label: 'Phone' },
              { label: 'Status', variant: 'badge' },
              { label: 'Sent' },
              { label: 'Delivered' },
              { label: 'Read' },
              { label: 'Error' },
            ]}
          />
        ) : recipientError ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2">
            <p className="text-red-foreground text-sm">
              Failed to load recipients: {recipientError}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRecipientRequest((current) => current + 1)}
            >
              Retry
            </Button>
          </div>
        ) : recipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-muted-foreground text-sm">
              {statusFilter === 'all'
                ? 'No recipients found.'
                : 'No recipients match this filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow interactive={false} className="border-border">
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Read</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  return (
                    <TableRow key={recipient.id} className="border-border">
                      <TableCell className="text-foreground font-medium">
                        {recipient.contact?.name ?? 'Unknown'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.contact?.phone
                          ? fmt.phone(recipient.contact.phone)
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge className={rStatus.classes}>
                          {rStatus.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.sent_at
                          ? fmt.dateTime(recipient.sent_at)
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.delivered_at
                          ? fmt.dateTime(recipient.delivered_at)
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.read_at
                          ? fmt.dateTime(recipient.read_at)
                          : '-'}
                      </TableCell>
                      <TableCell className="text-red-foreground max-w-xs truncate text-xs">
                        {recipient.error_message ?? '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {nextRecipientCursor && (
              <div className="flex justify-center px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  loading={loadingMoreRecipients}
                  onClick={() => void loadMoreRecipients()}
                >
                  Load more recipients
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
