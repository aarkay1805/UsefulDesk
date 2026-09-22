export type OrganizationNameSetupState = 'complete' | 'pending' | 'unavailable';

const COMPLETION_FIELD = 'organization_name_setup_completed_at';
const POSTGREST_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/;

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isPostgrestTimestamp(value: string) {
  const match = POSTGREST_TIMESTAMP.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[7];
  const offsetHour = Number(match[8]);
  const offsetMinute = Number(match[9]);
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  if (
    offset !== 'Z' &&
    (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0))
  ) {
    return false;
  }

  return Number.isFinite(Date.parse(value));
}

/**
 * Interpret the membership-scoped organization setup projection without
 * collapsing an omitted or malformed field into the database's explicit
 * pending value.
 */
export function readOrganizationNameSetupState(
  branch: unknown
): OrganizationNameSetupState {
  if (
    typeof branch !== 'object' ||
    branch === null ||
    !Object.prototype.hasOwnProperty.call(branch, COMPLETION_FIELD)
  ) {
    return 'unavailable';
  }

  const completedAt = (branch as Record<string, unknown>)[COMPLETION_FIELD];
  if (completedAt === null) return 'pending';
  if (typeof completedAt === 'string' && isPostgrestTimestamp(completedAt)) {
    return 'complete';
  }
  return 'unavailable';
}
