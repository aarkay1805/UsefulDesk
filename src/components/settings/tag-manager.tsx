'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Loader2,
  Plus,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import type { Tag } from '@/types';

// Tags render with the neutral badge treatment everywhere. The database
// column remains required, so new rows keep the canonical slate value.
const DEFAULT_TAG_COLOR = '#64748b';

export function TagManager({ canEdit }: { canEdit: boolean }) {
  const supabase = createClient();
  const { user, accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  useEffect(() => {
    if (authLoading || !accountId) return;
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });

      if (cancelled) return;
      if (error) {
        setLoadError(getErrorMessage(error, "Tags couldn't load. Try again."));
      } else {
        setTags((data as Tag[] | null) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, authLoading, reloadNonce, supabase]);

  async function handleCreate() {
    const name = newTagName.trim();
    if (!canEdit || !name) return;
    if (!user || !accountId) {
      toast.error('Your profile is not linked to an account.');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('tags')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name,
          color: DEFAULT_TAG_COLOR,
        })
        .select('*')
        .maybeSingle();

      if (error || !data) {
        throw error ?? new Error('The tag was not created.');
      }

      setTags((current) => [...current, data as Tag]);
      setNewTagName('');
      toast.success('Tag created');
    } catch (error) {
      toast.error(getErrorMessage(error, "The tag couldn't be created."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!canEdit || !tagToDelete) return;

    setDeleting(true);
    try {
      const { data, error } = await supabase
        .from('tags')
        .delete()
        .eq('id', tagToDelete.id)
        .select('id');

      if (error || !data?.length) {
        throw error ?? new Error('The tag was not deleted.');
      }

      setTags((current) => current.filter((tag) => tag.id !== tagToDelete.id));
      setTagToDelete(null);
      toast.success('Tag deleted');
    } catch (error) {
      toast.error(getErrorMessage(error, "The tag couldn't be deleted."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TagIcon className="size-4" aria-hidden="true" />
          Tags
        </CardTitle>
        <CardDescription>
          Use simple labels for quick grouping and filters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div
            className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading tags…
          </div>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>Tags couldn&apos;t load</AlertTitle>
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
          <>
            {tags.length > 0 ? (
              <ul className="divide-border border-border divide-y rounded-lg border">
                {tags.map((tag) => (
                  <li
                    key={tag.id}
                    className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm font-medium">
                      {tag.name}
                    </span>
                    <Button
                      type="button"
                      variant="destructive-ghost"
                      size="icon-sm"
                      onClick={() => setTagToDelete(tag)}
                      disabled={!canEdit}
                      aria-label={`Delete ${tag.name}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No tags yet.</p>
            )}

            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreate();
              }}
            >
              <Label htmlFor="new-tag-name">New tag</Label>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  id="new-tag-name"
                  placeholder="e.g. Newsletter"
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                  disabled={!canEdit || saving}
                  maxLength={40}
                />
                <Button
                  type="submit"
                  disabled={!canEdit || saving || !newTagName.trim()}
                  className="w-full sm:w-auto"
                >
                  {saving ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Plus className="size-4" aria-hidden="true" />
                  )}
                  {saving ? 'Adding…' : 'Add tag'}
                </Button>
              </div>
            </form>
          </>
        )}
      </CardContent>

      <Dialog
        open={Boolean(tagToDelete)}
        onOpenChange={(open) => {
          if (!open && !deleting) setTagToDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete tag?</DialogTitle>
            <DialogDescription>
              “{tagToDelete?.name}” will be removed from every contact. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTagToDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              {deleting ? 'Deleting…' : 'Delete tag'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
