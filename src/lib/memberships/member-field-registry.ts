import type { TargetKind } from '@/lib/contacts/field-mapping';

export type MemberFilterDim = 'plans' | 'statuses' | 'feeStatus' | 'churnRisk';

export type MemberColumnKey =
  | 'name'
  | 'memberId'
  | 'plan'
  | 'expiry'
  | 'status'
  | 'assignee'
  | 'trainer'
  | 'fee'
  | 'churnRisk'
  | 'reminder';

export type MemberImportFieldKey =
  | 'phone'
  | 'name'
  | 'email'
  | 'company'
  | 'legacy_member_id'
  | 'offering'
  | 'membership_plan'
  | 'membership_option'
  | 'membership_trainer'
  | 'membership_list_price'
  | 'membership_discount_amount'
  | 'membership_discount_percent'
  | 'service'
  | 'service_option'
  | 'service_trainer'
  | 'service_start'
  | 'service_end'
  | 'service_list_price'
  | 'service_discount_amount'
  | 'service_discount_percent'
  | 'service_sold_price'
  | 'service_status'
  /** Legacy saved-draft key; new mapping UI uses membership_plan. */
  | 'plan'
  | 'pricing_option'
  | 'start_date'
  | 'end_date'
  | 'status'
  | 'freeze_date'
  | 'assigned_to'
  | 'fee_amount'
  | 'amount_paid'
  | 'amount_due'
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

/**
 * Mapping-picker groups. Membership and service each own a complete set of
 * dates, status, and money fields, so a column such as "Start date" can never
 * be ambiguous about which purchase it describes. Collection stays row-level:
 * one CSV row is one invoice, so paid/due/method/date describe that invoice
 * rather than an individual line.
 */
export type MemberImportGroup =
  | 'contact'
  | 'mixed'
  | 'membership'
  | 'service'
  | 'payment'
  | 'member'
  | 'profile'
  | 'tags';

export const MEMBER_IMPORT_GROUP_LABEL: Record<MemberImportGroup, string> = {
  contact: 'Contact',
  mixed: 'Mixed column',
  membership: 'Membership',
  service: 'Service',
  payment: 'Payment (this row)',
  member: 'Member',
  profile: 'Profile',
  tags: 'Tags',
};

export const MEMBER_IMPORT_GROUP_ORDER: MemberImportGroup[] = [
  'contact',
  'mixed',
  'membership',
  'service',
  'payment',
  'member',
  'profile',
  'tags',
];

export interface MemberImportField {
  key: MemberImportFieldKey;
  label: string;
  kind: TargetKind;
  /** Which mapping-picker section this field belongs to. */
  group: MemberImportGroup;
  /**
   * Shown inside its group, where the group heading already supplies the
   * context. `label` stays fully qualified because the closed picker and the
   * preview render it without a heading, and the auto-mapper matches on it.
   */
  groupLabel?: string;
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
   * Ships hidden until someone re-adds it from the column controls. Seeded
   * once per layout version, so a later default change cannot silently
   * override a layout the user has already arranged.
   */
  defaultHidden?: boolean;
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
  group: MemberImportGroup,
  synonyms: string[],
  extra: { required?: boolean; groupLabel?: string } = {}
): MemberImportField => ({
  key,
  label,
  kind,
  group,
  synonyms,
  required: extra.required ?? false,
  ...(extra.groupLabel ? { groupLabel: extra.groupLabel } : {}),
});

/**
 * Canonical member-import vocabulary. Header auto-mapping, the searchable
 * mapping picker, the sample file, and the commit engine all consume this
 * list. Aliases intentionally cover exports from Indian and international
 * gym products without tying UsefulDesk to any vendor.
 *
 * ORDER IS LOAD-BEARING. `autoMapColumns` walks this list and claims the
 * first unused target whose label or synonym matches, so membership fields
 * must precede their service twins: a bare "Start date" column belongs to
 * the membership, and a service column has to say so.
 */
export const MEMBER_IMPORT_FIELDS: MemberImportField[] = [
  field(
    'phone',
    'Phone',
    'standard',
    'contact',
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
    { required: true }
  ),
  field('name', 'Name', 'standard', 'contact', [
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
  field('email', 'Email', 'standard', 'contact', [
    'email',
    'e mail',
    'email address',
    'mail',
    'primary email',
  ]),
  field('company', 'Company', 'standard', 'contact', [
    'company',
    'business',
    'organisation',
    'organization',
    'employer',
  ]),
  field('offering', 'Plan or service', 'member', 'mixed', [
    'offering',
    'package',
    'package name',
    'product or service',
    'plan or service',
  ]),
  field(
    'membership_plan',
    'Membership plan',
    'member',
    'membership',
    [
      'plan',
      'plan name',
      'membership',
      'membership plan',
      'membership package',
      'membership type',
      'scheme',
      'subscription',
    ],
    { required: true, groupLabel: 'Plan' }
  ),
  field('membership_option', 'Billing option', 'member', 'membership', [
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
  // A bare "Trainer" column in a member export means the member's trainer,
  // so this must precede `service_trainer`, which the auto-mapper would
  // otherwise claim first and then drop on any row without a service.
  field('membership_trainer', 'Trainer', 'member', 'membership', [
    'trainer',
    'coach',
    'instructor',
    'personal trainer',
    'assigned trainer',
    'member trainer',
    'pt',
  ]),
  field('start_date', 'Start date', 'member', 'membership', [
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
  field('end_date', 'Expiry', 'member', 'membership', [
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
  field('status', 'Status', 'member', 'membership', [
    'status',
    'member status',
    'membership status',
    'subscription status',
    'account status',
  ]),
  field('freeze_date', 'Freeze date', 'member', 'membership', [
    'freeze date',
    'frozen date',
    'paused date',
    'hold date',
    'membership freeze date',
  ]),
  field('membership_list_price', 'List price', 'payment', 'membership', [
    'list price',
    'actual amt',
    'actual amount',
    'gross amount',
    'gross fee',
    'original price',
    'original amount',
    'before discount',
    'mrp',
    'rack rate',
    'standard price',
    'undiscounted amount',
  ]),
  field(
    'membership_discount_amount',
    'Discount amount',
    'payment',
    'membership',
    [
      'discount',
      'discount amt',
      'discount amount',
      'discount value',
      'concession',
      'concession amount',
      'rebate',
      'waiver',
      'waived amount',
      'less',
    ]
  ),
  field('membership_discount_percent', 'Discount %', 'payment', 'membership', [
    'discount percent',
    'discount percentage',
    'discount pct',
    'discount rate',
    'percent discount',
    'percentage discount',
  ]),
  field('fee_amount', 'Fee charged', 'payment', 'membership', [
    'fee',
    'fees',
    'fee amount',
    'fee charged',
    'plan fee',
    'membership fee',
    'subscription fee',
    'amount',
    'price',
    'total',
    'total fee',
    'net amount',
    'net fee',
    'final fee',
    'final amount',
    'discounted amt',
    'discounted amount',
    'after discount',
    'invoice amount',
  ]),
  field('service', 'Service', 'member', 'service', [
    'service',
    'service name',
    'class',
    'class name',
    'session service',
  ]),
  field(
    'service_option',
    'Service option',
    'member',
    'service',
    [
      'service option',
      'service duration',
      'service validity',
      'service package option',
    ],
    { groupLabel: 'Option' }
  ),
  field(
    'service_trainer',
    'Service trainer',
    'member',
    'service',
    ['service trainer', 'trainer', 'coach', 'instructor', 'personal trainer'],
    { groupLabel: 'Trainer' }
  ),
  field(
    'service_start',
    'Service start date',
    'member',
    'service',
    ['service start', 'service start date', 'class start'],
    { groupLabel: 'Start date' }
  ),
  field(
    'service_end',
    'Service expiry',
    'member',
    'service',
    [
      'service end',
      'service end date',
      'service expiry',
      'service expiry date',
    ],
    { groupLabel: 'Expiry' }
  ),
  field(
    'service_status',
    'Service status',
    'member',
    'service',
    ['service status', 'class status'],
    { groupLabel: 'Status' }
  ),
  field(
    'service_list_price',
    'Service list price',
    'payment',
    'service',
    [
      'service list price',
      'service actual amount',
      'service original price',
      'service gross amount',
      'service mrp',
    ],
    { groupLabel: 'List price' }
  ),
  field(
    'service_discount_amount',
    'Service discount amount',
    'payment',
    'service',
    [
      'service discount',
      'service discount amount',
      'service concession',
      'service rebate',
    ],
    { groupLabel: 'Discount amount' }
  ),
  field(
    'service_discount_percent',
    'Service discount %',
    'payment',
    'service',
    ['service discount percent', 'service discount percentage'],
    { groupLabel: 'Discount %' }
  ),
  field(
    'service_sold_price',
    'Service price charged',
    'payment',
    'service',
    [
      'service sold price',
      'service price',
      'sold price',
      'package sold price',
      'service net amount',
      'service final amount',
    ],
    { groupLabel: 'Price charged' }
  ),
  field('amount_paid', 'Amount paid', 'payment', 'payment', [
    'amount paid',
    'paid amount',
    'paid amp',
    'paid amt',
    'payment amount',
    'collected',
    'collected amount',
    'received amount',
    'total paid',
    'paid',
  ]),
  field('amount_due', 'Amount due', 'payment', 'payment', [
    'amount due',
    'balance',
    'balance amount',
    'due amount',
    'outstanding',
    'outstanding amount',
    'pending amount',
    'pending payment',
    'remaining amount',
    'arrears',
    'unpaid amount',
  ]),
  field('payment_method', 'Payment method', 'payment', 'payment', [
    'payment method',
    'payment mode',
    'mode of payment',
    'paid by',
    'tender',
    'collection method',
  ]),
  field('paid_at', 'Payment date', 'payment', 'payment', [
    'payment date',
    'paid date',
    'paid on',
    'collected date',
    'collection date',
    'last payment date',
    'receipt date',
  ]),
  field('fee_status', 'Fee status', 'payment', 'payment', [
    'fee status',
    'payment status',
    'invoice status',
    'dues status',
    'paid status',
    'balance status',
  ]),
  field('legacy_member_id', 'Member ID (old system)', 'member', 'member', [
    'member id',
    'membership id',
    'customer id',
    'client id',
    'legacy id',
    'legacy member id',
    'old member id',
    'old id',
    'member no',
    'member number',
    'member code',
    'registration no',
    'reg no',
  ]),
  field('assigned_to', 'Assigned to', 'member', 'member', [
    'assigned to',
    'assignee',
    'owner',
    'account owner',
    'sales rep',
    'representative',
    'agent',
    'staff',
  ]),
  field('churn_risk', 'Churn risk', 'member', 'member', [
    'churn risk',
    'at risk',
    'risk',
    'retention risk',
    'likely to churn',
  ]),
  field('notes', 'Notes', 'member', 'member', [
    'notes',
    'note',
    'remarks',
    'comments',
    'member notes',
    'special instructions',
  ]),
  field('date_of_birth', 'Birthday', 'profile', 'profile', [
    'birthday',
    'birth date',
    'date of birth',
    'dob',
    'd o b',
  ]),
  field('gender', 'Gender', 'profile', 'profile', ['gender', 'sex']),
  field('nickname', 'Nickname', 'profile', 'profile', [
    'nickname',
    'preferred name',
    'display name',
  ]),
  field('height_cm', 'Height', 'profile', 'profile', [
    'height',
    'height cm',
    'height in cm',
    'height centimetres',
    'height centimeters',
  ]),
  field('weight_kg', 'Weight', 'profile', 'profile', [
    'weight',
    'weight kg',
    'weight in kg',
    'weight kilograms',
  ]),
  field('address_line1', 'Address line 1', 'profile', 'profile', [
    'address',
    'address line 1',
    'street',
    'street address',
    'home address',
  ]),
  field('address_line2', 'Address line 2', 'profile', 'profile', [
    'address line 2',
    'address 2',
    'area',
    'locality',
    'landmark',
  ]),
  field('city', 'City', 'profile', 'profile', ['city', 'town', 'district']),
  field('state', 'State', 'profile', 'profile', [
    'state',
    'province',
    'region',
  ]),
  field('postal_code', 'Postal code', 'profile', 'profile', [
    'postal code',
    'postcode',
    'post code',
    'pin',
    'pin code',
    'pincode',
    'zip',
    'zip code',
  ]),
  field('country', 'Country', 'profile', 'profile', ['country', 'nation']),
  field('tags', 'Tags', 'tags', 'tags', [
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
    importPolicy: {
      kind: 'fields',
      fields: ['name', 'phone', 'email', 'legacy_member_id'],
    },
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
    importPolicy: {
      kind: 'fields',
      fields: [
        'offering',
        'membership_plan',
        'membership_option',
        'service',
        'service_option',
      ],
    },
  },
  {
    key: 'expiry',
    label: 'Expiry',
    defaultWidth: 130,
    minWidth: 100,
    sortKey: 'end_date',
    importPolicy: {
      kind: 'fields',
      fields: ['start_date', 'end_date', 'service_start', 'service_end'],
    },
  },
  {
    key: 'status',
    label: 'Status',
    defaultWidth: 140,
    minWidth: 110,
    filterDim: 'statuses',
    importPolicy: {
      kind: 'fields',
      fields: ['status', 'freeze_date', 'service_status'],
    },
  },
  {
    // The staff owner, which always costs a login seat. Superseded on this
    // table by Trainer, but kept re-addable: its cell is also where a pending
    // lead-assignment request and its Withdraw control surface.
    key: 'assignee',
    label: 'Assigned to',
    defaultWidth: 170,
    minWidth: 130,
    defaultHidden: true,
    importPolicy: {
      kind: 'fields',
      fields: ['assigned_to', 'service_trainer'],
    },
  },
  {
    key: 'trainer',
    label: 'Trainer',
    defaultWidth: 170,
    minWidth: 130,
    importPolicy: { kind: 'fields', fields: ['membership_trainer'] },
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
        'membership_list_price',
        'membership_discount_amount',
        'membership_discount_percent',
        'fee_amount',
        'service_list_price',
        'service_discount_amount',
        'service_discount_percent',
        'service_sold_price',
        'amount_paid',
        'amount_due',
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
