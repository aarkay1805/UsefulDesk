import {
  resolveAccountLocale,
  type AccountLocale,
} from '../../../../src/lib/locale/config';
import {
  buildFormatters,
  type LocaleFormatters,
} from '../../../../src/lib/locale/format';

import type { AccountSummary } from '../features/auth/branch-types';

export function accountLocale(account: AccountSummary): AccountLocale {
  return resolveAccountLocale(account);
}

export function accountFormatters(account: AccountSummary): LocaleFormatters {
  return buildFormatters(accountLocale(account));
}
