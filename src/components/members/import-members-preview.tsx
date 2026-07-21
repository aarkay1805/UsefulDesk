'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
  EditableCell,
  type CellOption,
} from '@/components/leads/editable-cell';
import { AssigneeDisplay } from '@/components/leads/lead-cell-renderers';
import { useLocale } from '@/hooks/use-locale';
import { daysUntil, effectiveStatus } from '@/lib/memberships/expiry';
import {
  MEMBER_TABLE_COLUMNS,
  type MemberColumn,
} from '@/lib/memberships/member-field-registry';
import type {
  BuiltMemberRow,
  MemberImportRow,
  MemberRowError,
} from '@/lib/memberships/import-commit';
import { isChargeableAmount } from '@/lib/memberships/periods';
import type { Membership, MembershipPlan } from '@/types';
import type { StaffMember } from './use-account-staff';
import { MemberIdentity } from './member-identity';
import {
  FeeStatusBadge,
  MembershipStatusBadge,
} from './membership-status-badge';

const PREVIEW_CAP = 200;

const ERROR_LABEL: Record<MemberRowError, string> = {
  'unknown-plan': 'Plan needs matching',
  'no-pricing': 'Plan has no active billing option',
  'bad-date': 'Check date values',
  'bad-fee': 'Check the fee',
  'bad-payment': 'Check amount paid',
  'payment-exceeds-fee': 'Amount paid exceeds the fee',
  'unknown-status': 'Status needs matching',
  'expired-needs-expiry': 'Expired rows need a past expiry',
};

export interface MemberImportPreviewRow {
  source: MemberImportRow;
  built: BuiltMemberRow;
  existingContactId: string | null;
  existingReceivedVia: string | null;
  alreadyMember: boolean;
}

interface ImportMembersPreviewProps {
  rows: MemberImportPreviewRow[];
  mappedKeys: Set<string>;
  plans: MembershipPlan[];
  staff: StaffMember[];
  nameById: Map<string, string>;
  avatarById: Map<string, string | null>;
  skippedNoPhone: number;
  skippedInvalidPhone: number;
  skippedDuplicates: number;
  onPatch: (index: number, patch: Partial<MemberImportRow>) => void;
  onBulkPlanFix: (rawPlan: string, planId: string) => void;
}

export function ImportMembersPreview({
  rows,
  mappedKeys,
  plans,
  staff,
  nameById,
  avatarById,
  skippedNoPhone,
  skippedInvalidPhone,
  skippedDuplicates,
  onPatch,
  onBulkPlanFix,
}: ImportMembersPreviewProps) {
  const { fmt } = useLocale();
  const [editing, setEditing] = useState<{
    row: number;
    key: string;
  } | null>(null);

  const columns = useMemo(
    () =>
      MEMBER_TABLE_COLUMNS.filter((column) => {
        if (column.importPolicy.kind !== 'fields') return false;
        return column.importPolicy.fields.some((key) => mappedKeys.has(key));
      }),
    [mappedKeys]
  );
  const invalid = rows.filter(
    (row) => !row.alreadyMember && row.built.errors.length > 0
  ).length;
  const alreadyMembers = rows.filter((row) => row.alreadyMember).length;
  const ready = rows.filter(
    (row) => !row.alreadyMember && row.built.membership
  ).length;

  const unknownPlans = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.built.errors.includes('unknown-plan')) continue;
      const raw = row.source.planName?.trim() || '(blank)';
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [rows]);

  const planOptions: CellOption[] = plans.map((plan) => ({
    value: plan.id,
    label: plan.name,
  }));
  const statusOptions: CellOption[] = [
    { value: 'active', label: 'Active' },
    { value: 'expired', label: 'Expired' },
    { value: 'frozen', label: 'Frozen' },
    { value: 'cancelled', label: 'Cancelled' },
  ];
  const staffOptions: CellOption[] = [
    { value: '', label: 'You (importer)' },
    ...staff.map((person) => ({
      value: person.user_id,
      label: person.full_name,
    })),
  ];
  const riskOptions: CellOption[] = [
    { value: 'no', label: 'No' },
    { value: 'yes', label: 'Yes' },
  ];

  function editCell(
    row: MemberImportPreviewRow,
    index: number,
    column: MemberColumn
  ) {
    const active = editing?.row === index && editing.key === column.key;
    const close = () => setEditing(null);
    const start = () => setEditing({ row: index, key: column.key });
    const built = row.built.membership;

    switch (column.key) {
      case 'name':
        return (
          <MemberIdentity
            name={row.source.name}
            secondary={row.source.phone}
            meta={
              row.alreadyMember
                ? 'Already a member — will skip'
                : row.existingContactId
                  ? 'Existing contact'
                  : undefined
            }
          />
        );
      case 'plan': {
        const plan = plans.find((item) => item.id === built?.plan_id);
        return (
          <EditableCell
            editing={active}
            saving={false}
            kind="select"
            value={plan?.id ?? ''}
            options={planOptions}
            display={
              plan ? (
                <span className="text-foreground truncate text-sm">
                  {plan.name}
                </span>
              ) : (
                <Badge variant="warning">
                  {row.source.planName || 'No plan'}
                </Badge>
              )
            }
            onStart={start}
            onCancel={close}
            onCommit={(planId) => {
              const next = plans.find((item) => item.id === planId);
              if (next) {
                onPatch(index, {
                  planName: next.name,
                  pricingOption: '',
                });
              }
              close();
            }}
          />
        );
      }
      case 'expiry':
        return (
          <EditableCell
            editing={active}
            saving={false}
            kind="text"
            value={row.source.endDate || built?.end_date || ''}
            display={
              <span className="text-muted-foreground text-sm">
                {built?.end_date ? fmt.date(built.end_date) : 'Check date'}
              </span>
            }
            onStart={start}
            onCancel={close}
            onCommit={(value) => {
              onPatch(index, { endDate: value });
              close();
            }}
          />
        );
      case 'status': {
        const status = built
          ? effectiveStatus(
              built as Pick<Membership, 'status' | 'end_date'>,
              fmt.today()
            )
          : 'active';
        return (
          <EditableCell
            editing={active}
            saving={false}
            kind="select"
            value={status}
            options={statusOptions}
            display={
              built ? (
                <MembershipStatusBadge
                  status={status}
                  daysToExpiry={daysUntil(built.end_date, fmt.today())}
                />
              ) : (
                <Badge variant="warning">
                  {row.source.status || 'Check status'}
                </Badge>
              )
            }
            onStart={start}
            onCancel={close}
            onCommit={(value) => {
              onPatch(index, { status: value });
              close();
            }}
          />
        );
      }
      case 'assignee':
        return (
          <EditableCell
            editing={active}
            saving={false}
            kind="select"
            value={row.built.assignedTo ?? ''}
            options={staffOptions}
            display={
              row.built.assignedTo ? (
                <AssigneeDisplay
                  name={nameById.get(row.built.assignedTo) ?? 'Teammate'}
                  avatarUrl={avatarById.get(row.built.assignedTo)}
                />
              ) : row.built.warnings.includes('unknown-assignee') ? (
                <Badge variant="warning">
                  {row.source.assignedTo || 'Unknown'}
                </Badge>
              ) : (
                <span className="text-muted-foreground text-sm">
                  You (importer)
                </span>
              )
            }
            onStart={start}
            onCancel={close}
            onCommit={(userId) => {
              onPatch(index, {
                assignedTo:
                  staff.find((person) => person.user_id === userId)
                    ?.full_name ?? '',
              });
              close();
            }}
          />
        );
      case 'fee': {
        const payment = row.built.payment?.amount ?? 0;
        const paid = built
          ? !isChargeableAmount(Number(built.fee_amount) - payment)
          : false;
        return (
          <EditableCell
            editing={active}
            saving={false}
            kind="number"
            value={row.source.fee || String(built?.fee_amount ?? '')}
            display={
              built ? (
                <span className="flex items-center gap-1.5">
                  <FeeStatusBadge status={paid ? 'paid' : 'due'} />
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {fmt.money(built.fee_amount)}
                  </span>
                </span>
              ) : (
                <Badge variant="warning">Check fee</Badge>
              )
            }
            onStart={start}
            onCancel={close}
            onCommit={(value) => {
              onPatch(index, { fee: value });
              close();
            }}
          />
        );
      }
      case 'churnRisk':
        return (
          <EditableCell
            editing={active}
            saving={false}
            kind="select"
            value={row.built.churnRisk ? 'yes' : 'no'}
            options={riskOptions}
            display={
              row.built.churnRisk ? (
                <Badge variant="danger">Yes</Badge>
              ) : (
                <span className="text-muted-foreground text-sm">No</span>
              )
            }
            onStart={start}
            onCancel={close}
            onCommit={(value) => {
              onPatch(index, { churnRisk: value });
              close();
            }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">{ready} ready</Badge>
        {invalid > 0 && (
          <Badge variant="warning">{invalid} need attention</Badge>
        )}
        {alreadyMembers > 0 && (
          <Badge variant="neutral">{alreadyMembers} already members</Badge>
        )}
        {skippedNoPhone > 0 && (
          <Badge variant="neutral">{skippedNoPhone} without phone</Badge>
        )}
        {skippedInvalidPhone > 0 && (
          <Badge variant="neutral">{skippedInvalidPhone} invalid phones</Badge>
        )}
        {skippedDuplicates > 0 && (
          <Badge variant="neutral">{skippedDuplicates} duplicates</Badge>
        )}
      </div>

      {unknownPlans.length > 0 && (
        <div className="border-border bg-background/40 rounded-lg border p-3">
          <div className="mb-2 flex items-start gap-2">
            <AlertTriangle className="text-amber-foreground mt-0.5 size-4 shrink-0" />
            <div>
              <p className="text-foreground text-sm font-medium">
                Match plan names once
              </p>
              <p className="text-muted-foreground text-xs">
                A choice applies to every row carrying that source value.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {unknownPlans.map(([rawPlan, count]) => (
              <div
                key={rawPlan}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2"
              >
                <div className="min-w-0">
                  <p className="text-foreground truncate text-xs font-medium">
                    {rawPlan}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {count} row{count === 1 ? '' : 's'}
                  </p>
                </div>
                <Select
                  value={null}
                  onValueChange={(planId) =>
                    planId && onBulkPlanFix(rawPlan, planId)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-border ring-border/50 min-h-0 flex-1 overflow-auto rounded-xl border ring-1">
        <Table className="min-w-[760px] table-fixed">
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  style={{ width: column.defaultWidth }}
                >
                  {column.label}
                </TableHead>
              ))}
              <TableHead className="w-40">Import check</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, PREVIEW_CAP).map((row, index) => (
              <TableRow key={`${row.source.phone}-${index}`}>
                {columns.map((column) => (
                  <TableCell key={column.key} className="p-0">
                    {editCell(row, index, column)}
                  </TableCell>
                ))}
                <TableCell>
                  {row.alreadyMember ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                      <CheckCircle className="size-3.5" /> Skip existing
                    </span>
                  ) : row.built.errors.length === 0 ? (
                    <span className="text-emerald-foreground inline-flex items-center gap-1.5 text-xs">
                      <CheckCircle className="size-3.5" /> Ready
                    </span>
                  ) : (
                    <span className="text-red-foreground inline-flex items-start gap-1.5 text-xs">
                      <XCircle className="mt-px size-3.5 shrink-0" />
                      {ERROR_LABEL[row.built.errors[0]]}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {rows.length > PREVIEW_CAP && (
        <p className="text-muted-foreground text-xs">
          Showing the first {PREVIEW_CAP} of {rows.length} rows — all valid rows
          will be imported.
        </p>
      )}
    </div>
  );
}
