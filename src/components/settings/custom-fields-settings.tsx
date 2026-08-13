'use client';

import { Shield, SlidersHorizontal } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CustomFieldsPanel } from '@/components/contacts/custom-fields-manager';
import { SettingsChip } from './settings-chip';

/**
 * Settings → Custom Fields card. Manages the account-wide custom
 * contact field catalogue (the same panel the Contacts page exposes
 * via a dialog). Writes are admin-gated by the caller and enforced by
 * `custom_fields` RLS.
 */
export function CustomFieldsSettings({ canEdit }: { canEdit: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Custom fields
          <SettingsChip variant="admin">
            <Shield />
            Admin
          </SettingsChip>
        </CardTitle>
        <CardDescription>
          Store structured details on every contact and use them in automations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CustomFieldsPanel canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}
