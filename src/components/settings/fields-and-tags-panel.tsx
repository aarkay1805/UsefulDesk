'use client';

import { useCan } from '@/hooks/use-can';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/use-auth';

import { CustomFieldsSettings } from './custom-fields-settings';
import { SettingsPanelHead } from './settings-panel-head';
import { TagManager } from './tag-manager';

/**
 * "Fields & tags" section — merges the former Tags and Custom Fields
 * tabs. Tags are visible to everyone; the custom-fields catalogue is
 * account-wide config. Non-admins can review both catalogues in a disabled
 * read-only state; `tags` and `custom_fields` RLS still reject their writes.
 */
export function FieldsAndTagsPanel() {
  const canEditSettings = useCan('edit-settings');
  const { profileLoading } = useAuth();

  return (
    <section className="animate-in fade-in-50 max-w-3xl space-y-4 duration-200">
      <SettingsPanelHead
        title="Tags & contact details"
        description="Use tags to group contacts. Save any extra details your team needs."
      />
      {!profileLoading && !canEditSettings ? (
        <Alert>
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            Ask an admin or owner to change tags or contact details.
          </AlertDescription>
        </Alert>
      ) : null}
      <TagManager canEdit={canEditSettings} />
      <CustomFieldsSettings canEdit={canEditSettings} />
    </section>
  );
}
