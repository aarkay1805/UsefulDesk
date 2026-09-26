'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import type { CustomField } from '@/types';

interface CustomFieldsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Dialog wrapper used by the Contacts page. */
export function CustomFieldsManager({
  open,
  onOpenChange,
}: CustomFieldsManagerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Extra details</DialogTitle>
          <DialogDescription>
            Save extra details your team needs for each person, like their usual class time.
          </DialogDescription>
        </DialogHeader>
        <CustomFieldsPanel />
      </DialogContent>
    </Dialog>
  );
}

/** Create, rename, and delete account-wide custom contact fields. */
export function CustomFieldsPanel({ canEdit = true }: { canEdit?: boolean }) {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fieldToDelete, setFieldToDelete] = useState<CustomField | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from('custom_fields')
        .select('*')
        .eq('account_id', accountId)
        .order('field_name');

      if (cancelled) return;
      if (error) {
        setLoadError(
          getErrorMessage(
            error,
            "Extra details could not load. Try again."
          )
        );
      } else {
        setFields((data as CustomField[] | null) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, reloadNonce, supabase]);

  function isDuplicate(name: string, exceptId?: string): boolean {
    const lower = name.toLowerCase();
    return fields.some(
      (field) =>
        field.id !== exceptId && field.field_name.toLowerCase() === lower
    );
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!canEdit || !name) return;
    if (!accountId || !user) {
      toast.error('Your login is not linked to a gym.');
      return;
    }
    if (isDuplicate(name)) {
      toast.error(`“${name}” is already in the list.`);
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('custom_fields')
        .insert({
          field_name: name,
          field_type: 'text',
          user_id: user.id,
          account_id: accountId,
        })
        .select('*')
        .maybeSingle();

      if (error || !data) {
        throw error ?? new Error('The custom field was not created.');
      }

      setFields((current) =>
        [...current, data as CustomField].sort((a, b) =>
          a.field_name.localeCompare(b.field_name)
        )
      );
      setNewName('');
      toast.success(`Added “${name}”`);
    } catch (error) {
      toast.error(
        getErrorMessage(error, "The custom field could not be created.")
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(
    field: CustomField,
    nextName: string
  ): Promise<boolean> {
    const name = nextName.trim();
    if (!canEdit) return false;
    if (!name || name === field.field_name) return true;
    if (isDuplicate(name, field.id)) {
      toast.error(`“${name}” is already in the list.`);
      return false;
    }

    setBusyId(field.id);
    try {
      const { data, error } = await supabase
        .from('custom_fields')
        .update({ field_name: name })
        .eq('id', field.id)
        .select('*')
        .maybeSingle();

      if (error || !data) {
        throw error ?? new Error('The custom field was not renamed.');
      }

      setFields((current) =>
        current
          .map((item) => (item.id === field.id ? (data as CustomField) : item))
          .sort((a, b) => a.field_name.localeCompare(b.field_name))
      );
      return true;
    } catch (error) {
      toast.error(
        getErrorMessage(error, "The custom field could not be renamed.")
      );
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!canEdit || !fieldToDelete) return;

    setBusyId(fieldToDelete.id);
    try {
      const { data, error } = await supabase
        .from('custom_fields')
        .delete()
        .eq('id', fieldToDelete.id)
        .select('id');

      if (error || !data?.length) {
        throw error ?? new Error('The custom field was not deleted.');
      }

      setFields((current) =>
        current.filter((field) => field.id !== fieldToDelete.id)
      );
      toast.success(`Deleted “${fieldToDelete.field_name}”`);
      setFieldToDelete(null);
    } catch (error) {
      toast.error(
        getErrorMessage(error, "The custom field could not be deleted.")
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <Label htmlFor="new-custom-field">New detail</Label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            id="new-custom-field"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Example: Usual class time"
            disabled={!canEdit || creating}
          />
          <Button
            type="submit"
            disabled={!canEdit || creating || !newName.trim()}
            className="w-full sm:w-auto"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            {creating ? 'Adding…' : 'Add detail'}
          </Button>
        </div>
      </form>

      {loadError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Could not load extra details</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button
              variant="destructive"
              size="sm"
              className="mt-3"
              onClick={() => setReloadNonce((nonce) => nonce + 1)}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="-mx-1 max-h-72 overflow-y-auto px-1 py-1">
          <div className="border-border rounded-lg border">
            {loading ? (
              <div
                className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm"
                role="status"
                aria-live="polite"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Loading extra details…
              </div>
            ) : fields.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No extra details yet.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    busy={busyId === field.id}
                    canEdit={canEdit}
                    onRename={handleRename}
                    onDelete={setFieldToDelete}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(fieldToDelete)}
        onOpenChange={(open) => {
          if (!open && !busyId) setFieldToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete extra detail?</DialogTitle>
            <DialogDescription>
              “{fieldToDelete?.field_name}” will be deleted from every person, with the saved values. You cannot undo this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFieldToDelete(null)}
              disabled={Boolean(busyId)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={Boolean(busyId)}
            >
              {busyId && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              {busyId ? 'Deleting…' : 'Delete detail'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldRow({
  field,
  busy,
  canEdit,
  onRename,
  onDelete,
}: {
  field: CustomField;
  busy: boolean;
  canEdit: boolean;
  onRename: (field: CustomField, name: string) => Promise<boolean>;
  onDelete: (field: CustomField) => void;
}) {
  const [name, setName] = useState(field.field_name);

  async function commit() {
    if (name.trim() === field.field_name) {
      setName(field.field_name);
      return;
    }
    const ok = await onRename(field, name);
    if (!ok) setName(field.field_name);
  }

  return (
    <li className="flex min-h-11 items-center gap-2 px-3 py-2">
      <Input
        value={name}
        disabled={!canEdit || busy}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setName(field.field_name);
            event.currentTarget.blur();
          }
        }}
        aria-label={`Rename ${field.field_name}`}
        className="min-w-0 flex-1"
      />
      <Button
        variant="destructive-ghost"
        size="icon-sm"
        disabled={!canEdit || busy}
        onClick={() => onDelete(field)}
        aria-label={`Delete ${field.field_name}`}
        className="shrink-0"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-4" aria-hidden="true" />
        )}
      </Button>
    </li>
  );
}
