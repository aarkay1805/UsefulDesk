import type { TargetKind } from '@/lib/contacts/field-mapping';

export type MemberFilterDim = 'plans' | 'statuses' | 'feeStatus' | 'churnRisk';

export type MemberColumnKey =
  | 'name'
  | 'memberId'
  | 'plan'
  | 'expiry'
  | 'status'
  | 'assignee'
  | 'fee'
  | 'churnRisk'
  | 'reminder';

export type MemberImportFieldKey =
  | 'phone'
  | 'name'
  | 'email'
  | 'company'
  | 'plan'
  | 'pricing_option'
  | 'start_date'
  | 'end_date'
  | 'status'
  | 'freeze_date'
  | 'assigned_to'
  | 'fee_amount'
  | 'amount_paid'
  | 'fee_status'
  | 'payment_method'
  | 'paid_at'
  | 'churn_risk'
  | 'date_of_birth'
  | 'gender'
  | 'nickname'
  | 'height_cm'
  | 'weight_kg'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'state'
  | 'postal_code'
  | 'country'
  | 'notes'
  | 'tags';

export interface MemberImportField {
  key: MemberImportFieldKey;
  label: string;
  kind: TargetKind;
  required?: boolean;
  synonyms: string[];
}

export interface MemberColumn {
  key: MemberColumnKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
  required?: boolean;
  align?: 'right';
  sortKey?: string;
  filterDim?: MemberFilterDim;
  /**
   * Every data column declares how it participates in member migration.
   * `generated` and `action` are deliberate exceptions; everything else
   * must name one or more import fields. Tests keep this contract closed.
   */
  importPolicy:
    | { kind: 'fields'; fields: MemberImportFieldKey[] }
    | { kind: 'generated'; reason: string }
    | { kind: 'action'; reason: string };
}

const field = (
  key: MemberImportFieldKey,
  label: string,
  kind: TargetKind,
  synonyms: string[],
  required = false
): MemberImportField => ({ key, label, kind, synonyms, required });

/**
 * Canonical member-import vocabulary. Header auto-mapping, the searchable
 * mapping picker, the sample file, and the commit engine all consume this
 * list. Aliases intentionally cover exports from Indian and international
 * gym products without tying UsefulDesk to any vendor.
 */
export const MEMBER_IMPORT_FIELDS: MemberImportField[] = [
  field(
    'phone',
    'Phone',
    'standard',
    [
      'phone',
      'mobile',
      'mobile no',
      'mobile number',
      'phone no',
      'phone number',
      'contact',
      'contact no',
      'contact number',
      'whatsapp',
      'whatsapp no',
      'cell',
      'cell phone',
      'msisdn',
      'primary phone',
    ],
    true
  ),
  field('name', 'Name', 'standard', [
    'name',
    'full name',
    'member',
    'member name',
    'customer',
    'customer name',
    'client',
    'client name',
    'first and last name',
  ]),
  field('email', 'Email', 'standard', [
    'email',
    'e mail',
    'email address',
    'mail',
    'primary email',
  ]),
  field('company', 'Company', 'standard', [
    'company',
    'business',
    'organisation',
    'organization',
    'employer',
  ]),
  field(
    'plan',
    'Plan',
    'member',
    [
      'plan',
      'plan name',
      'membership',
      'membership plan',
      'membership type',
      'package',
      'package name',
      'scheme',
      'product',
      'service',
      'subscription',
    ],
    true
  ),
  field('pricing_option', 'Billing option', 'member', [
    'billing option',
    'billing cycle',
    'billing frequency',
    'plan duration',
    'duration',
    'term',
    'tenure',
    'frequency',
    'validity',
  ]),
  field('start_date', 'Start date', 'member', [
    'start',
    'start date',
    'joined',
    'joined date',
    'join date',
    'joining date',
    'enrolment date',
    'enrollment date',
    'membership start',
    'subscription start',
    'activation date',
    'from date',
  ]),
  field('end_date', 'Expiry', 'member', [
    'end',
    'end date',
    'expiry',
    'expiry date',
    'expiration',
    'expiration date',
    'expires',
    'valid till',
    'valid until',
    'membership end',
    'subscription end',
    'renewal date',
    'next renewal',
    'due date',
    'to date',
  ]),
  field('status', 'Status', 'member', [
    'status',
    'member status',
    'membership status',
    'subscription status',
    'account status',
  ]),
  field('freeze_date', 'Freeze date', 'member', [
    'freeze date',
    'frozen date',
    'paused date',
    'hold date',
    'membership freeze date',
  ]),
  field('assigned_to', 'Assigned to', 'member', [
    'assigned to',
    'assignee',
    'owner',
    'account owner',
    'sales rep',
    'representative',
    'agent',
    'trainer',
    'coach',
    'staff',
  ]),
  field('fee_amount', 'Fee', 'payment', [
    'fee',
    'fees',
    'fee amount',
    'plan fee',
    'membership fee',
    'subscription fee',
    'amount',
    'price',
    'total',
    'total fee',
    'invoice amount',
  ]),
  field('amount_paid', 'Amount paid', 'payment', [
    'amount paid',
    'paid amount',
    'payment amount',
    'collected',
    'collected amount',
    'received amount',
    'total paid',
    'paid',
  ]),
  field('fee_status', 'Fee status', 'payment', [
    'fee status',
    'payment status',
    'invoice status',
    'dues status',
    'paid status',
    'balance status',
  ]),
  field('payment_method', 'Payment method', 'payment', [
    'payment method',
    'payment mode',
    'mode of payment',
    'paid by',
    'tender',
    'collection method',
  ]),
  field('paid_at', 'Payment date', 'payment', [
    'payment date',
    'paid date',
    'paid on',
    'collected date',
    'collection date',
    'last payment date',
    'receipt date',
  ]),
  field('churn_risk', 'Churn risk', 'member', [
    'churn risk',
    'at risk',
    'risk',
    'retention risk',
    'likely to churn',
  ]),
  field('date_of_birth', 'Birthday', 'profile', [
    'birthday',
    'birth date',
    'date of birth',
    'dob',
    'd o b',
  ]),
  field('gender', 'Gender', 'profile', ['gender', 'sex']),
  field('nickname', 'Nickname', 'profile', [
    'nickname',
    'preferred name',
    'display name',
  ]),
  field('height_cm', 'Height', 'profile', [
    'height',
    'height cm',
    'height in cm',
    'height centimetres',
    'height centimeters',
  ]),
  field('weight_kg', 'Weight', 'profile', [
    'weight',
    'weight kg',
    'weight in kg',
    'weight kilograms',
  ]),
  field('address_line1', 'Address line 1', 'profile', [
    'address',
    'address line 1',
    'street',
    'street address',
    'home address',
  ]),
  field('address_line2', 'Address line 2', 'profile', [
    'address line 2',
    'address 2',
    'area',
    'locality',
    'landmark',
  ]),
  field('city', 'City', 'profile', ['city', 'town', 'district']),
  field('state', 'State', 'profile', ['state', 'province', 'region']),
  field('postal_code', 'Postal code', 'profile', [
    'postal code',
    'postcode',
    'post code',
    'pin',
    'pin code',
    'pincode',
    'zip',
    'zip code',
  ]),
  field('country', 'Country', 'profile', ['country', 'nation']),
  field('notes', 'Notes', 'member', [
    'notes',
    'note',
    'remarks',
    'comments',
    'member notes',
    'special instructions',
  ]),
  field('tags', 'Tags', 'tags', [
    'tags',
    'tag',
    'labels',
    'label',
    'groups',
    'segments',
  ]),
];

/**
 * Canonical All Members table columns. Import participation lives beside
 * the table metadata so adding a future member column cannot create a
 * second, drifting mapping list.
 */
export const MEMBER_TABLE_COLUMNS: MemberColumn[] = [
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 220,
    minWidth: 150,
    required: true,
    sortKey: 'name',
    importPolicy: { kind: 'fields', fields: ['name', 'phone', 'email'] },
  },
  {
    key: 'memberId',
    label: 'Member ID',
    defaultWidth: 120,
    minWidth: 95,
    sortKey: 'member_number',
    importPolicy: {
      kind: 'generated',
      reason: 'Member IDs are allocated by the database and never reused.',
    },
  },
  {
    key: 'plan',
    label: 'Plan',
    defaultWidth: 150,
    minWidth: 100,
    filterDim: 'plans',
    importPolicy: { kind: 'fields', fields: ['plan', 'pricing_option'] },
  },
  {
    key: 'expiry',
    label: 'Expiry',
    defaultWidth: 130,
    minWidth: 100,
    sortKey: 'end_date',
    importPolicy: { kind: 'fields', fields: ['start_date', 'end_date'] },
  },
  {
    key: 'status',
    label: 'Status',
    defaultWidth: 140,
    minWidth: 110,
    filterDim: 'statuses',
    importPolicy: {
      kind: 'fields',
      fields: ['status', 'freeze_date'],
    },
  },
  {
    key: 'assignee',
    label: 'Assigned to',
    defaultWidth: 170,
    minWidth: 130,
    importPolicy: { kind: 'fields', fields: ['assigned_to'] },
  },
  {
    key: 'fee',
    label: 'Fee',
    defaultWidth: 160,
    minWidth: 120,
    sortKey: 'fee_amount',
    filterDim: 'feeStatus',
    importPolicy: {
      kind: 'fields',
      fields: [
        'fee_amount',
        'amount_paid',
        'fee_status',
        'payment_method',
        'paid_at',
      ],
    },
  },
  {
    key: 'churnRisk',
    label: 'Churn risk',
    defaultWidth: 120,
    minWidth: 100,
    filterDim: 'churnRisk',
    importPolicy: { kind: 'fields', fields: ['churn_risk'] },
  },
  {
    key: 'reminder',
    label: 'Actions',
    defaultWidth: 240,
    minWidth: 210,
    align: 'right',
    importPolicy: {
      kind: 'action',
      reason: 'Actions are controls, not member data.',
    },
  },
];

export const MEMBER_COLUMN_BY_KEY: Record<string, MemberColumn> =
  Object.fromEntries(
    MEMBER_TABLE_COLUMNS.map((column) => [column.key, column])
  );

export const MEMBER_IMPORT_FIELD_BY_KEY = new Map(
  MEMBER_IMPORT_FIELDS.map((item) => [item.key, item])
);
