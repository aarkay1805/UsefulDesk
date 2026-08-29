import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  customerRowCapabilities,
  type MemberCustomerDirectoryRow,
} from '@/lib/memberships/customer-directory';
import { MEMBER_COLUMN_BY_KEY } from '@/lib/memberships/member-field-registry';

function row(
  membershipId: string | null
): Pick<MemberCustomerDirectoryRow, 'customer_kind' | 'membership_id'> {
  return {
    customer_kind: membershipId ? 'membership' : 'service',
    membership_id: membershipId,
  };
}

describe('All members row capabilities', () => {
  it('keeps contact-level actions for a service customer', () => {
    expect(customerRowCapabilities(row(null))).toEqual({
      details: true,
      followUp: true,
      addPurchase: true,
      assignment: true,
      notes: true,
      membershipActions: false,
      selectableForMembershipBulkActions: false,
    });
  });

  it('preserves every membership-backed action for a membership customer', () => {
    expect(customerRowCapabilities(row('membership-1'))).toEqual({
      details: true,
      followUp: true,
      addPurchase: true,
      assignment: true,
      notes: true,
      membershipActions: true,
      selectableForMembershipBulkActions: true,
    });
  });
});

describe('All Members table parity contract', () => {
  const source = readFileSync(resolve(__dirname, 'members-table.tsx'), 'utf8');
  const pageSource = readFileSync(
    resolve(__dirname, '../../app/(dashboard)/members/page.tsx'),
    'utf8'
  );
  const bulkNoteSource = readFileSync(
    resolve(__dirname, '../leads/bulk-add-note-dialog.tsx'),
    'utf8'
  );
  const bulkPaymentSource = readFileSync(
    resolve(__dirname, 'bulk-record-payment-dialog.tsx'),
    'utf8'
  );

  it('resets paging for toolbar, column, and page-size ordering changes', () => {
    expect(source).toMatch(
      /function setTableSort[\s\S]*?setPrefs[\s\S]*?setPage\(0\);/
    );
    expect(source).toMatch(
      /function sortByColumn[\s\S]*?nextMemberColumnSort[\s\S]*?setPage\(0\);/
    );
    expect(source).toMatch(
      /function setPageSize[\s\S]*?pageSize: nextPageSize[\s\S]*?setPage\(0\);/
    );
  });

  it('keeps the page-size, record-range, and width-reset controls wired', () => {
    expect(source).toContain('Records per page');
    expect(source).toContain(
      'memberTableRecordRange(totalCount, page, pageSize)'
    );
    expect(source).toContain('Reset column widths');
    expect(source).toMatch(/function resetColumnWidths[\s\S]*?widths: \{\}/);
  });

  it('wires Assigned to and Trainer headers to the same MemberFilters state as the main popover', () => {
    expect(MEMBER_COLUMN_BY_KEY.assignee.filterDim).toBe('assignees');
    expect(MEMBER_COLUMN_BY_KEY.trainer.filterDim).toBe('trainers');
    expect(source).toContain('assignedOptions={assignedFilterOptions}');
    expect(source).toContain('trainerOptions={trainerFilterOptions}');
    expect(source).toMatch(
      /case 'assignees':[\s\S]*?options = assignedFilterOptions;/
    );
    expect(source).toMatch(
      /case 'trainers':[\s\S]*?options = trainerFilterOptions;/
    );
    expect(source).toContain(
      'selected: (filters[col.filterDim] as string[]) ?? []'
    );
  });

  it('wires the shared bulk editor to the selected member count and safe member property allowlist', () => {
    expect(source).toContain('buildMemberBulkEditProperties(staff, trainers)');
    expect(source).toMatch(
      /<GatedButton[\s\S]*?gateReason="edit members"[\s\S]*?>[\s\S]*?<Pencil \/>[\s\S]*?Edit/
    );
    expect(source).toMatch(
      /<BulkEditDialog[\s\S]*?count=\{selected\.size\}[\s\S]*?noun="member"[\s\S]*?properties=\{bulkEditProperties\}[\s\S]*?onApply=\{handleBulkEdit\}/
    );
  });

  it('keeps assignment approval-gated and proves direct contact writes before clearing failures', () => {
    expect(source).toContain(
      'requestLeadAssignment(supabase, contactId, target)'
    );
    expect(source).toMatch(
      /\.update\(patch\)[\s\S]*?\.eq\('account_id', accountId\)[\s\S]*?\.select\('id'\)/
    );
    expect(source).toContain('retainFailedMemberSelection(');
    expect(source).toContain('toast.warning');
  });

  it('keys every row, page, and All matching selection by contact while retaining an optional membership id', () => {
    expect(source).toContain(
      'const [selected, setSelected] = useState<MemberSelection>(new Map())'
    );
    expect(source).toContain('checked={selected.has(customer.contact_id)}');
    expect(source).not.toMatch(
      /aria-label=\{`Select \$\{customer\.contact[\s\S]*?disabled=\{!membership\}/
    );
    expect(source).toContain('toggleMemberPageSelection(current, rows)');
    expect(source).toContain(
      'setSelected(memberSelectionFromRows(result.rows))'
    );
    expect(source).not.toContain(
      'rows.filter((row) => row.membership_id !== null)'
    );
  });

  it('keeps contact-safe Edit and Add note available for service-only and mixed selections', () => {
    expect(source).toMatch(
      /<GatedButton[\s\S]*?gateReason="edit members"[\s\S]*?>[\s\S]*?<Pencil \/>[\s\S]*?Edit/
    );
    expect(source).toMatch(
      /<GatedButton[\s\S]*?gateReason="add notes"[\s\S]*?>[\s\S]*?<StickyNote \/>[\s\S]*?Add note/
    );
    expect(source).toContain('contactIds={selectionSummary.contactIds}');
    expect(source).toContain('onDone={finishContactSafeBulkAction}');
    expect(bulkNoteSource).toContain('contact_notes');
    expect(bulkNoteSource).not.toContain('follow_ups');
    expect(bulkNoteSource).toContain('failedContactIds');
  });

  it('omits membership actions for service-only selections and blocks mixed selections instead of using a hidden subset', () => {
    expect(source).toMatch(
      /selectionSummary\.membershipActionState !== 'hidden'[\s\S]*?<ResolvableAction[\s\S]*?Remind[\s\S]*?<ResolvableAction[\s\S]*?Record payment[\s\S]*?<ResolvableAction[\s\S]*?Delete/
    );
    expect(source).toContain("title: 'Membership customers only'");
    expect(source).toContain('membershipOnlyMemberSelection(current)');
    expect(source).toContain('membershipIds={selectionSummary.membershipIds}');
    expect(source).not.toMatch(
      /membershipIds=\{\[\.\.\.selected\.(keys|values)\(\)\]\}/
    );
  });

  it('retains only proven failures after safe and membership bulk actions', () => {
    expect(source).toMatch(
      /function finishContactSafeBulkAction[\s\S]*?retainFailedMemberSelection[\s\S]*?result\.failedContactIds/
    );
    expect(source).toMatch(
      /function finishMembershipBulkAction[\s\S]*?result\.failedMembershipIds[\s\S]*?retainFailedMemberSelection/
    );
    expect(source).toMatch(
      /sendBulkReminders[\s\S]*?failedContactIds[\s\S]*?retainFailedMemberSelection/
    );
    expect(source).toMatch(
      /deleteSelectedMembers[\s\S]*?retainFailedMemberSelection/
    );
    expect(bulkPaymentSource).toContain('failedMembershipIds');
    expect(bulkPaymentSource).toContain('completedMembershipIds');
  });

  it('bounds the table to the available page height and keeps the footer outside its two-axis scroll region', () => {
    expect(pageSource).toContain(
      '<div className="flex h-full min-h-0 flex-col">'
    );
    expect(pageSource).toMatch(
      /view === 'all' \? 'min-h-0 flex-1' : undefined/
    );
    expect(source).toMatch(
      /<section[^>]*className="[^"]*flex[^"]*h-full[^"]*min-h-0[^"]*flex-col[^"]*overflow-hidden[^"]*"/
    );
    expect(source).toMatch(
      /data-slot="members-table-scroll-region"[\s\S]*?className="min-h-0 flex-1 overflow-auto"/
    );
    expect(source).toMatch(
      /data-slot="members-table-scroll-region"[\s\S]*?data-slot="members-table-footer"/
    );
    expect(source).toMatch(/data-slot="members-table-footer"[\s\S]*?shrink-0/);
  });

  it('keeps the real and loading headers sticky with unchanged frozen checkbox and Name offsets', () => {
    expect(source.match(/containerClassName="overflow-visible"/g)).toHaveLength(
      2
    );
    expect(
      source.match(/headerClassName="bg-card sticky top-0 z-10"/g)
    ).toHaveLength(1);
    expect(source).toContain(
      '<TableHeader className="bg-card sticky top-0 z-10">'
    );
    expect(source).toContain(
      "prefs.nameFrozen && 'bg-card sticky left-0 z-20'"
    );
    expect(source).toContain('left: CHECKBOX_COL_WIDTH');
    expect(source).not.toMatch(
      /data-slot="members-table-scroll-region"[^>]*transform/
    );
  });
});
