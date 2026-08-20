'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { canManageExpenseCategories } from '@/lib/auth/roles';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { getErrorMessage } from '@/lib/errors';
import {
  EXPENSE_CATEGORY_DUPLICATE_MESSAGE,
  nextExpenseCategorySortOrder,
  validateExpenseCategoryName,
} from '@/lib/finance/expense-categories';
import { createClient } from '@/lib/supabase/client';
import type { ExpenseCategory } from '@/types';

interface CategoryEditor {
  category: ExpenseCategory | null;
}

export function ExpenseCategoriesCard() {
  const supabase = createClient();
  const { accountId, accountRole, profileLoading } = useAuth();
  const mayManage = accountRole
    ? canManageExpenseCategories(accountRole)
    : false;

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [editor, setEditor] = useState<CategoryEditor | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (profileLoading) return;
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setLoadError(null);

      if (!accountId) {
        setLoadError('No account is selected.');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('expense_categories')
        .select(
          'id, account_id, name, is_active, sort_order, created_at, updated_at'
        )
        .eq('account_id', accountId)
        .order('is_active', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (cancelled) return;
      if (error) {
        setLoadError(
          getErrorMessage(error, "Expense categories couldn't load. Try again.")
        );
      } else {
        setCategories((data as ExpenseCategory[] | null) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, profileLoading, reloadNonce, supabase]);

  const sortedCategories = useMemo(
    () =>
      [...categories].sort(
        (left, right) =>
          Number(right.is_active) - Number(left.is_active) ||
          left.sort_order - right.sort_order ||
          left.name.localeCompare(right.name)
      ),
    [categories]
  );

  function refresh() {
    setLoading(true);
    setReloadNonce((nonce) => nonce + 1);
  }

  function openCreate() {
    setEditor({ category: null });
    setName('');
    setNameError(null);
  }

  function openEdit(category: ExpenseCategory) {
    setEditor({ category });
    setName(category.name);
    setNameError(null);
  }

  function closeEditor() {
    if (saving) return;
    setEditor(null);
    setName('');
    setNameError(null);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mayManage || !accountId || !editor || saving) return;

    const trimmedName = name.trim();
    const validationError = validateExpenseCategoryName(
      trimmedName,
      categories,
      editor.category?.id
    );
    if (validationError) {
      setNameError(validationError);
      return;
    }

    setSaving(true);
    setNameError(null);
    try {
      if (editor.category) {
        const { data, error } = await supabase
          .from('expense_categories')
          .update({ name: trimmedName })
          .eq('id', editor.category.id)
          .eq('account_id', accountId)
          .select('id');
        if (error || !data?.length) {
          throw error ?? new Error('The expense category was not updated.');
        }
        toast.success('Expense category updated');
      } else {
        const { data, error } = await supabase
          .from('expense_categories')
          .insert({
            account_id: accountId,
            name: trimmedName,
            sort_order: nextExpenseCategorySortOrder(categories),
          })
          .select('id')
          .maybeSingle();
        if (error || !data) {
          throw error ?? new Error('The expense category was not added.');
        }
        toast.success('Expense category added');
      }

      setEditor(null);
      setName('');
      refresh();
    } catch (error) {
      if (isUniqueViolation(error)) {
        setNameError(EXPENSE_CATEGORY_DUPLICATE_MESSAGE);
      } else {
        toast.error(
          getErrorMessage(
            error,
            "The expense category couldn't be saved. Try again."
          )
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function setActive(category: ExpenseCategory, isActive: boolean) {
    if (!mayManage || !accountId || updatingId) return;
    if (isActive) {
      const validationError = validateExpenseCategoryName(
        category.name,
        categories,
        category.id
      );
      if (validationError) {
        toast.error(validationError);
        return;
      }
    }

    setUpdatingId(category.id);
    try {
      const { data, error } = await supabase
        .from('expense_categories')
        .update({ is_active: isActive })
        .eq('id', category.id)
        .eq('account_id', accountId)
        .select('id');
      if (error || !data?.length) {
        throw error ?? new Error('The expense category was not updated.');
      }
      toast.success(
        isActive ? 'Expense category restored' : 'Expense category archived'
      );
      refresh();
    } catch (error) {
      toast.error(
        isUniqueViolation(error)
          ? EXPENSE_CATEGORY_DUPLICATE_MESSAGE
          : getErrorMessage(
              error,
              "The expense category couldn't be updated. Try again."
            )
      );
    } finally {
      setUpdatingId(null);
    }
  }

  const editingCategory = editor?.category ?? null;
  const unchanged = editingCategory
    ? name.trim() === editingCategory.name
    : name.trim() === '';

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Expense categories</CardTitle>
          {mayManage &&
          !loading &&
          !loadError &&
          sortedCategories.length > 0 ? (
            <CardAction>
              <Button size="sm" onClick={openCreate}>
                <Plus aria-hidden="true" /> Add category
              </Button>
            </CardAction>
          ) : null}
          <CardDescription>
            Keep expense entry consistent with a short, reusable category list.
            Archived categories remain on historical records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!mayManage && !profileLoading ? (
            <Alert>
              <AlertTitle>Read-only</AlertTitle>
              <AlertDescription>
                Only account admins can change expense categories.
              </AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div
              className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading expense categories…
            </div>
          ) : loadError ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>Expense categories couldn&apos;t load</AlertTitle>
              <AlertDescription>
                <p>{loadError}</p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="mt-3"
                  onClick={refresh}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : sortedCategories.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-foreground text-sm font-medium">
                No expense categories yet
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Add a category before recording the next expense.
              </p>
              {mayManage ? (
                <Button className="mt-4" size="sm" onClick={openCreate}>
                  <Plus aria-hidden="true" /> Add category
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-2">
              {sortedCategories.map((category) => (
                <li
                  key={category.id}
                  className="border-border flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {category.name}
                  </span>
                  {!category.is_active ? (
                    <Badge variant="neutral">Archived</Badge>
                  ) : null}
                  {mayManage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Manage ${category.name}`}
                            disabled={updatingId === category.id}
                          />
                        }
                      >
                        {updatingId === category.id ? (
                          <Loader2
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <MoreHorizontal aria-hidden="true" />
                        )}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        <DropdownMenuItem onClick={() => openEdit(category)}>
                          <Pencil aria-hidden="true" /> Edit name
                        </DropdownMenuItem>
                        {category.is_active ? (
                          <DropdownMenuItem
                            onClick={() => void setActive(category, false)}
                          >
                            <Archive aria-hidden="true" /> Archive category
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => void setActive(category, true)}
                          >
                            <RotateCcw aria-hidden="true" /> Restore category
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent>
          <form onSubmit={handleSave} className="contents" noValidate>
            <DialogHeader>
              <DialogTitle>
                {editingCategory ? 'Edit expense category' : 'Add category'}
              </DialogTitle>
              <DialogDescription>
                Categories keep expense entry and reporting consistent.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="expense-category-name">Category name</Label>
              <Input
                id="expense-category-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="Equipment & maintenance"
                autoFocus
                disabled={saving}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? 'category-name-error' : undefined}
              />
              {nameError ? (
                <p
                  id="category-name-error"
                  className="text-destructive text-xs"
                  role="alert"
                >
                  {nameError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeEditor}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || unchanged}>
                {saving ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                ) : editingCategory ? (
                  'Save changes'
                ) : (
                  'Add category'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
