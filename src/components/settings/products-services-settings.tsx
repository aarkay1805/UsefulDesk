'use client';

import { useEffect, useState } from 'react';
import {
  Archive,
  Loader2,
  Plus,
  RotateCcw,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/hooks/use-locale';
import {
  canManageCatalog as canManageCatalogForRole,
  canManageTrainers as canManageTrainersForRole,
} from '@/lib/auth/roles';
import { currencySymbol } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import { durationLabel } from '@/lib/memberships/pricing';
import type {
  AccountMember,
  CatalogItem,
  CatalogItemKind,
  CatalogOption,
  DurationUnit,
  Trainer,
  TrainerRate,
} from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/ui/user-avatar';
import { ROLE_META } from './role-meta';
import { SettingsPanelHead } from './settings-panel-head';

type HydratedItem = CatalogItem & {
  catalog_options: (CatalogOption & { trainer_rates: TrainerRate[] })[];
};

type ArchiveTable = 'catalog_items' | 'catalog_options';

type ArchiveTarget = {
  table: ArchiveTable;
  id: string;
  title: string;
  description: string;
};

type DeleteTarget = Pick<CatalogItem, 'id' | 'name'>;

const EMPTY_ITEM = {
  name: '',
  description: '',
  kind: 'service' as CatalogItemKind,
  requiresTrainer: false,
};

function trainerPricingLabel(
  option: HydratedItem['catalog_options'][number],
  activeTrainerCount: number
): string {
  const pricedTrainerCount = option.trainer_rates.filter(
    (rate) => rate.is_active
  ).length;
  return pricedTrainerCount === 0
    ? 'Rate missing'
    : `${pricedTrainerCount} of ${activeTrainerCount} active trainers priced`;
}

function catalogOptionLabel(
  option: HydratedItem['catalog_options'][number]
): string {
  return option.duration_count && option.duration_unit
    ? durationLabel(option.duration_count, option.duration_unit)
    : 'Unit price';
}

export function ProductsServicesSettings() {
  const supabase = createClient();
  const { accountId, accountRole } = useAuth();
  const { fmt } = useLocale();
  const canManageCatalog = accountRole
    ? canManageCatalogForRole(accountRole)
    : false;
  const canManageTrainers = accountRole
    ? canManageTrainersForRole(accountRole)
    : false;
  const [items, setItems] = useState<HydratedItem[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [teamMembers, setTeamMembers] = useState<AccountMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [itemOpen, setItemOpen] = useState(false);
  const [optionItem, setOptionItem] = useState<HydratedItem | null>(null);
  const [trainerOpen, setTrainerOpen] = useState(false);
  const [rateOption, setRateOption] = useState<{
    item: HydratedItem;
    option: HydratedItem['catalog_options'][number];
  } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(
    null
  );
  const [archiving, setArchiving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingTrainerUserId, setPendingTrainerUserId] = useState<
    string | null
  >(null);
  const [trainerDeleteTarget, setTrainerDeleteTarget] =
    useState<Trainer | null>(null);
  const [deletingTrainer, setDeletingTrainer] = useState(false);
  const activeTrainerCount = trainers.filter(
    (trainer) => trainer.is_active
  ).length;

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const [itemResult, trainerResult, memberResponse] = await Promise.all([
          supabase
            .from('catalog_items')
            .select('*, catalog_options(*, trainer_rates(*))')
            .order('is_active', { ascending: false })
            .order('name'),
          supabase
            .from('trainers')
            .select('*')
            .order('is_active', { ascending: false })
            .order('display_name'),
          fetch('/api/account/members', { cache: 'no-store' }),
        ]);
        const memberPayload = memberResponse.ok
          ? ((await memberResponse.json()) as { members: AccountMember[] })
          : null;
        if (cancelled) return;
        if (itemResult.error || trainerResult.error || !memberPayload) {
          toast.error(
            itemResult.error?.message ||
              trainerResult.error?.message ||
              'Failed to load the team roster'
          );
        }
        setItems((itemResult.data as HydratedItem[]) ?? []);
        setTrainers((trainerResult.data as Trainer[]) ?? []);
        setTeamMembers(memberPayload?.members ?? []);
      } catch (error) {
        if (cancelled) return;
        toast.error(
          getErrorMessage(error, 'Failed to load products and services')
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadNonce, supabase]);

  function refresh() {
    setReloadNonce((value) => value + 1);
  }

  async function setArchived(
    table: ArchiveTable,
    id: string,
    active: boolean
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from(table)
      .update({ is_active: active })
      .eq('id', id)
      .select('id');
    if (error || !data?.length) {
      toast.error(
        error?.code === '23505' && table === 'catalog_options'
          ? 'An active option with the same duration already exists.'
          : error?.message || "You don't have permission to make this change"
      );
      return false;
    }
    toast.success(active ? 'Restored' : 'Archived');
    refresh();
    return true;
  }

  async function confirmArchive() {
    if (!archiveTarget || archiving) return;
    setArchiving(true);
    const archived = await setArchived(
      archiveTarget.table,
      archiveTarget.id,
      false
    );
    setArchiving(false);
    if (archived) setArchiveTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting || !accountId) return;
    setDeleting(true);
    const { data, error } = await supabase
      .from('catalog_items')
      .delete()
      .eq('id', deleteTarget.id)
      .eq('account_id', accountId)
      .select('id');
    setDeleting(false);

    if (error || !data?.length) {
      toast.error(
        error?.code === '23503'
          ? `${deleteTarget.name} has sales or service history — archive it instead.`
          : error?.message || "You don't have permission to delete this item"
      );
      return;
    }

    toast.success('Item permanently deleted');
    setDeleteTarget(null);
    refresh();
  }

  async function setTeamMemberTrainer(member: AccountMember, active: boolean) {
    if (!accountId || pendingTrainerUserId) return;
    const linkedTrainer = trainers.find(
      (trainer) => trainer.linked_user_id === member.user_id
    );
    if (!linkedTrainer && !active) return;

    setPendingTrainerUserId(member.user_id);
    const displayName = member.full_name.trim() || 'Teammate';
    const result = linkedTrainer
      ? await supabase
          .from('trainers')
          .update({
            is_active: active,
            ...(active ? { display_name: displayName } : {}),
          })
          .eq('id', linkedTrainer.id)
          .eq('account_id', accountId)
          .select('*')
          .single()
      : await supabase
          .from('trainers')
          .insert({
            account_id: accountId,
            linked_user_id: member.user_id,
            display_name: displayName,
          })
          .select('*')
          .single();
    setPendingTrainerUserId(null);

    if (result.error || !result.data) {
      toast.error(
        result.error?.code === '23505'
          ? 'A trainer with this name or team account already exists.'
          : getErrorMessage(result.error, 'Trainer status was not updated')
      );
      refresh();
      return;
    }

    const savedTrainer = result.data as Trainer;
    setTrainers((current) => {
      const exists = current.some((trainer) => trainer.id === savedTrainer.id);
      return exists
        ? current.map((trainer) =>
            trainer.id === savedTrainer.id ? savedTrainer : trainer
          )
        : [...current, savedTrainer];
    });
    toast.success(
      active
        ? `${displayName} is now a trainer`
        : `${displayName} removed from trainer assignments`
    );
  }

  async function confirmTrainerDelete() {
    if (!accountId || !trainerDeleteTarget || deletingTrainer) return;
    setDeletingTrainer(true);
    const { data, error } = await supabase
      .from('trainers')
      .delete()
      .eq('id', trainerDeleteTarget.id)
      .eq('account_id', accountId)
      .is('linked_user_id', null)
      .select('id');
    setDeletingTrainer(false);

    if (error || !data?.length) {
      toast.error(
        getErrorMessage(
          error,
          "You don't have permission to delete this trainer"
        )
      );
      refresh();
      return;
    }

    setTrainers((current) =>
      current.filter((trainer) => trainer.id !== trainerDeleteTarget.id)
    );
    toast.success(`${trainerDeleteTarget.display_name} deleted`);
    setTrainerDeleteTarget(null);
    refresh();
  }

  return (
    <section className="animate-in fade-in-50 max-w-5xl duration-200">
      <SettingsPanelHead
        title="Products & services"
        description="Sell time-bound services and merchandise alongside a membership. Trainer-priced services are available only where a duration-specific rate is configured."
      />

      <Tabs defaultValue="catalogue">
        <TabsList>
          <TabsTrigger value="catalogue">Catalogue</TabsTrigger>
          <TabsTrigger value="trainers">Trainers</TabsTrigger>
        </TabsList>

        <TabsContent value="catalogue" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              Services use calendar durations. Merchandise tracks quantity and
              revenue only.
            </p>
            {canManageCatalog ? (
              <Button onClick={() => setItemOpen(true)}>
                <Plus className="size-4" /> Add item
              </Button>
            ) : null}
          </div>
          {loading ? (
            <Loading />
          ) : items.length === 0 ? (
            <Empty
              icon={<ShoppingBag className="size-7" />}
              label="No products or services yet"
            />
          ) : (
            items.map((item) => (
              <Card
                key={item.id}
                className={item.is_active ? undefined : 'opacity-60'}
              >
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {item.name}
                    <Badge variant="neutral">
                      {item.kind === 'service' ? 'Service' : 'Merchandise'}
                    </Badge>
                    {item.requires_trainer ? (
                      <Badge variant="info">Trainer priced</Badge>
                    ) : null}
                    {!item.is_active ? (
                      <Badge variant="neutral">Archived</Badge>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {item.description ? (
                    <p className="text-muted-foreground text-sm">
                      {item.description}
                    </p>
                  ) : null}
                  {item.catalog_options.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No sellable options yet.
                    </p>
                  ) : (
                    <div className="divide-y rounded-lg border">
                      {[...item.catalog_options]
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((option) => (
                          <div
                            key={option.id}
                            className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                          >
                            <div className="min-w-40 flex-1">
                              <p className="font-medium">
                                {catalogOptionLabel(option)}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {item.requires_trainer
                                  ? trainerPricingLabel(
                                      option,
                                      activeTrainerCount
                                    )
                                  : option.standard_price == null
                                    ? 'Price missing'
                                    : fmt.money(option.standard_price)}
                              </p>
                            </div>
                            {!option.is_active ? (
                              <Badge variant="neutral">Archived</Badge>
                            ) : null}
                            {canManageCatalog &&
                            item.requires_trainer &&
                            option.is_active ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRateOption({ item, option })}
                              >
                                Rate matrix
                              </Button>
                            ) : null}
                            {canManageCatalog ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (option.is_active) {
                                    setArchiveTarget({
                                      table: 'catalog_options',
                                      id: option.id,
                                      title: `Archive ${catalogOptionLabel(option)}?`,
                                      description:
                                        'This option will no longer be available for new sales. Existing purchases and service history stay intact.',
                                    });
                                    return;
                                  }
                                  void setArchived(
                                    'catalog_options',
                                    option.id,
                                    true
                                  );
                                }}
                              >
                                {option.is_active ? (
                                  <Archive className="size-4" />
                                ) : (
                                  <RotateCcw className="size-4" />
                                )}
                                {option.is_active ? 'Archive' : 'Restore'}
                              </Button>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  )}
                  {canManageCatalog ? (
                    <div className="flex flex-wrap gap-2">
                      {item.is_active &&
                      (item.kind === 'service' ||
                        !item.catalog_options.some(
                          (option) => option.is_active
                        )) ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setOptionItem(item)}
                        >
                          <Plus className="size-4" /> Add{' '}
                          {item.kind === 'service' ? 'duration' : 'price'}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (item.is_active) {
                            setArchiveTarget({
                              table: 'catalog_items',
                              id: item.id,
                              title: `Archive ${item.name}?`,
                              description:
                                'This item and its options will no longer be available for new sales. Existing purchases and service history stay intact.',
                            });
                            return;
                          }
                          void setArchived('catalog_items', item.id, true);
                        }}
                      >
                        {item.is_active ? (
                          <Archive className="size-4" />
                        ) : (
                          <RotateCcw className="size-4" />
                        )}
                        {item.is_active ? 'Archive item' : 'Restore item'}
                      </Button>
                      <Button
                        variant="destructive-ghost"
                        size="sm"
                        onClick={() =>
                          setDeleteTarget({ id: item.id, name: item.name })
                        }
                      >
                        <Trash2 className="size-4" /> Delete item
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="trainers" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              Team members use a Trainer switch. Independent trainers can be
              deleted when no longer needed. Team access stays separate.
            </p>
            {canManageTrainers ? (
              <Button onClick={() => setTrainerOpen(true)}>
                <Plus className="size-4" /> Add independent trainer
              </Button>
            ) : null}
          </div>
          {loading ? (
            <Loading />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Team members</CardTitle>
                  <CardDescription>
                    A trainer switch does not change the teammate&apos;s account
                    role or permissions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {teamMembers.length === 0 ? (
                    <p className="text-muted-foreground px-4 pb-4 text-sm">
                      No registered team members found.
                    </p>
                  ) : (
                    <ul className="divide-border divide-y">
                      {teamMembers.map((member) => {
                        const linkedTrainer = trainers.find(
                          (trainer) => trainer.linked_user_id === member.user_id
                        );
                        const switchId = `team-trainer-${member.user_id}`;
                        const isPending =
                          pendingTrainerUserId === member.user_id;
                        return (
                          <TrainerSwitchRow
                            key={member.user_id}
                            switchId={switchId}
                            name={member.full_name || 'Teammate'}
                            avatarUrl={member.avatar_url}
                            context={`${ROLE_META[member.role].label} access`}
                            checked={linkedTrainer?.is_active ?? false}
                            pending={isPending}
                            disabled={!canManageTrainers}
                            onCheckedChange={(active) =>
                              void setTeamMemberTrainer(member, active)
                            }
                          />
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Independent trainers</CardTitle>
                  <CardDescription>
                    Trainers who do not need a UsefulDesk team account.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {trainers.filter((trainer) => !trainer.linked_user_id)
                    .length === 0 ? (
                    <p className="text-muted-foreground px-4 pb-4 text-sm">
                      No independent trainers yet.
                    </p>
                  ) : (
                    <ul className="divide-border divide-y">
                      {trainers
                        .filter((trainer) => !trainer.linked_user_id)
                        .map((trainer) => (
                          <TrainerRosterRow
                            key={trainer.id}
                            name={trainer.display_name}
                            context={trainer.title || 'Trainer'}
                            action={
                              <Button
                                variant="destructive-ghost"
                                size="icon-sm"
                                onClick={() => setTrainerDeleteTarget(trainer)}
                                disabled={
                                  !canManageTrainers ||
                                  (deletingTrainer &&
                                    trainerDeleteTarget?.id === trainer.id)
                                }
                                aria-label={`Delete ${trainer.display_name}`}
                              >
                                {deletingTrainer &&
                                trainerDeleteTarget?.id === trainer.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Trash2 className="size-4" />
                                )}
                              </Button>
                            }
                          />
                        ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {!canManageCatalog && !canManageTrainers ? (
        <p className="text-muted-foreground mt-4 text-xs">
          Only account admins can change the catalogue, trainers, or rates.
        </p>
      ) : null}

      <ItemDialog
        open={itemOpen}
        onOpenChange={setItemOpen}
        accountId={accountId}
        onSaved={refresh}
      />
      <OptionDialog
        key={optionItem?.id ?? 'no-option-item'}
        item={optionItem}
        onOpenChange={(open) => !open && setOptionItem(null)}
        accountId={accountId}
        onSaved={refresh}
      />
      <TrainerDialog
        open={trainerOpen}
        onOpenChange={setTrainerOpen}
        accountId={accountId}
        onSaved={refresh}
      />
      <RateMatrixDialog
        key={rateOption?.option.id ?? 'no-rate-option'}
        selection={rateOption}
        trainers={trainers}
        onOpenChange={(open) => !open && setRateOption(null)}
        accountId={accountId}
        onSaved={refresh}
      />
      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open && !archiving) setArchiveTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{archiveTarget?.title}</DialogTitle>
            <DialogDescription>{archiveTarget?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setArchiveTarget(null)}
              disabled={archiving}
            >
              Cancel
            </Button>
            <Button onClick={confirmArchive} disabled={archiving}>
              {archiving ? <Loader2 className="size-4 animate-spin" /> : null}
              {archiving ? 'Archiving…' : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the item, all its options, and saved
              trainer rates. Only items with no sales or service history can be
              deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
              {deleting ? 'Deleting…' : 'Delete item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={trainerDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletingTrainer) setTrainerDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {trainerDeleteTarget?.display_name}?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes the independent trainer and their saved
              rates. Existing invoices and service history keep the trainer name
              snapshot. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTrainerDeleteTarget(null)}
              disabled={deletingTrainer}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmTrainerDelete}
              disabled={deletingTrainer}
            >
              {deletingTrainer ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {deletingTrainer ? 'Deleting…' : 'Delete trainer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Loading() {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <Loader2 className="size-4 animate-spin" /> Loading…
    </div>
  );
}

function TrainerSwitchRow({
  switchId,
  name,
  avatarUrl,
  context,
  checked,
  pending,
  disabled,
  onCheckedChange,
}: {
  switchId: string;
  name: string;
  avatarUrl?: string | null;
  context: string;
  checked: boolean;
  pending: boolean;
  disabled: boolean;
  onCheckedChange: (active: boolean) => void;
}) {
  return (
    <TrainerRosterRow
      name={name}
      avatarUrl={avatarUrl}
      context={context}
      action={
        <div className="flex items-center gap-2">
          {pending ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          ) : null}
          <Label htmlFor={switchId}>
            Trainer
            <span className="sr-only"> for {name}</span>
          </Label>
          <Switch
            id={switchId}
            checked={checked}
            disabled={disabled || pending}
            onCheckedChange={(active) => onCheckedChange(active === true)}
          />
        </div>
      }
    />
  );
}

function TrainerRosterRow({
  name,
  avatarUrl,
  context,
  action,
}: {
  name: string;
  avatarUrl?: string | null;
  context: string;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <UserAvatar name={name} src={avatarUrl} className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="text-muted-foreground truncate text-sm">{context}</p>
      </div>
      {action}
    </li>
  );
}

function Empty({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
        {icon}
        {label}
      </CardContent>
    </Card>
  );
}

function ItemDialog({
  open,
  onOpenChange,
  accountId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState(EMPTY_ITEM);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!accountId || !form.name.trim())
      return toast.error('Enter an item name');
    setSaving(true);
    const { error } = await supabase.from('catalog_items').insert({
      account_id: accountId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      kind: form.kind,
      requires_trainer: form.kind === 'service' && form.requiresTrainer,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Catalogue item added');
    setForm(EMPTY_ITEM);
    onOpenChange(false);
    onSaved();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add catalogue item</DialogTitle>
          <DialogDescription>
            Add its sellable price or durations next.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field id="catalog-item-name" label="Name">
            <Input
              id="catalog-item-name"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </Field>
          <Field id="catalog-item-type" label="Type">
            <Select
              value={form.kind}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  kind: value as CatalogItemKind,
                  requiresTrainer:
                    value === 'service' ? form.requiresTrainer : false,
                })
              }
            >
              <SelectTrigger id="catalog-item-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="service">Service</SelectItem>
                <SelectItem value="merchandise">Merchandise</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="catalog-item-description" label="Description">
            <Textarea
              id="catalog-item-description"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </Field>
          {form.kind === 'service' ? (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <Label htmlFor="catalog-item-trainer-priced">
                  Trainer-priced
                </Label>
                <p className="text-muted-foreground text-xs">
                  Require an explicit trainer rate for every duration.
                </p>
              </div>
              <Switch
                id="catalog-item-trainer-priced"
                checked={form.requiresTrainer}
                onCheckedChange={(checked) =>
                  setForm({ ...form, requiresTrainer: checked })
                }
              />
            </div>
          ) : null}
        </div>
        <DialogFooter showCloseButton>
          <Button onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}Add
            item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionDialog({
  item,
  onOpenChange,
  accountId,
  onSaved,
}: {
  item: HydratedItem | null;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { locale } = useLocale();
  const [count, setCount] = useState('1');
  const [unit, setUnit] = useState<DurationUnit>('month');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const parsedCount = Number(count);
  const parsedPrice = Number(price);
  const durationIsValid =
    item?.kind !== 'service' ||
    (Number.isInteger(parsedCount) && parsedCount > 0);
  const priceIsValid =
    item?.requires_trainer === true ||
    (price.trim() !== '' && Number.isFinite(parsedPrice) && parsedPrice >= 0);
  const duplicateOption = item
    ? item.kind === 'service'
      ? durationIsValid &&
        item.catalog_options.some(
          (option) =>
            option.is_active &&
            option.duration_count === parsedCount &&
            option.duration_unit === unit
        )
      : item.catalog_options.some(
          (option) => option.is_active && option.duration_count == null
        )
    : false;
  const duplicateMessage = duplicateOption
    ? item?.kind === 'service'
      ? 'This duration already exists.'
      : 'This item already has an active unit price.'
    : null;
  const canSave =
    !!item && durationIsValid && priceIsValid && !duplicateOption && !saving;

  async function save() {
    if (!item || !accountId) return;
    if (duplicateMessage) return toast.error(duplicateMessage);
    if (
      (!item.requires_trainer || item.kind === 'merchandise') &&
      (!Number.isFinite(parsedPrice) || parsedPrice < 0)
    )
      return toast.error('Enter a valid price');
    if (
      item.kind === 'service' &&
      (!Number.isInteger(parsedCount) || parsedCount <= 0)
    )
      return toast.error('Enter a valid duration');
    setSaving(true);
    const { error } = await supabase.from('catalog_options').insert({
      account_id: accountId,
      item_id: item.id,
      duration_count: item.kind === 'service' ? parsedCount : null,
      duration_unit: item.kind === 'service' ? unit : null,
      standard_price: item.requires_trainer ? null : parsedPrice,
      sort_order: item.catalog_options.length,
    });
    setSaving(false);
    if (error) {
      return toast.error(
        error.code === '23505'
          ? item.kind === 'service'
            ? 'This duration already exists.'
            : 'This item already has an active unit price.'
          : error.message
      );
    }
    toast.success(
      item.requires_trainer
        ? 'Duration added — configure trainer rates next'
        : 'Sellable option added'
    );
    onOpenChange(false);
    onSaved();
  }
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Add {item?.kind === 'service' ? 'duration' : 'unit price'}
          </DialogTitle>
          <DialogDescription>
            {item?.requires_trainer
              ? 'This duration stays unavailable until at least one trainer rate is configured.'
              : item?.name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {item?.kind === 'service' ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <Field id="catalog-option-duration" label="Duration">
                  <Input
                    id="catalog-option-duration"
                    inputMode="numeric"
                    value={count}
                    onChange={(event) => setCount(event.target.value)}
                    aria-invalid={!durationIsValid || duplicateOption}
                    aria-describedby={
                      duplicateMessage ? 'catalog-option-error' : undefined
                    }
                  />
                </Field>
                <Field id="catalog-option-unit" label="Unit">
                  <Select
                    value={unit}
                    onValueChange={(value) => setUnit(value as DurationUnit)}
                  >
                    <SelectTrigger
                      id="catalog-option-unit"
                      className="w-full"
                      aria-invalid={duplicateOption}
                      aria-describedby={
                        duplicateMessage ? 'catalog-option-error' : undefined
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Days</SelectItem>
                      <SelectItem value="week">Weeks</SelectItem>
                      <SelectItem value="month">Months</SelectItem>
                      <SelectItem value="year">Years</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {duplicateMessage ? (
                <p
                  id="catalog-option-error"
                  role="alert"
                  className="text-destructive text-xs"
                >
                  {duplicateMessage}
                </p>
              ) : null}
            </div>
          ) : null}
          {!item?.requires_trainer ? (
            <Field id="catalog-option-price" label="Price">
              <CurrencyInput
                id="catalog-option-price"
                symbol={currencySymbol(locale.currency)}
                groupLocale={locale.locale}
                value={price}
                onValueChange={setPrice}
                placeholder="0"
                aria-invalid={duplicateOption}
                aria-describedby={
                  duplicateMessage ? 'catalog-option-error' : undefined
                }
                className="tabular-nums"
              />
            </Field>
          ) : null}
          {item?.kind === 'merchandise' && duplicateMessage ? (
            <p
              id="catalog-option-error"
              role="alert"
              className="text-destructive text-xs"
            >
              {duplicateMessage}
            </p>
          ) : null}
        </div>
        <DialogFooter showCloseButton>
          <Button onClick={save} disabled={!canSave}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}Add
            option
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrainerDialog({
  open,
  onOpenChange,
  accountId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!accountId || !name.trim())
      return toast.error('Enter the trainer name');
    setSaving(true);
    const { error } = await supabase.from('trainers').insert({
      account_id: accountId,
      display_name: name.trim(),
      title: title.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Trainer added');
    setName('');
    setTitle('');
    onOpenChange(false);
    onSaved();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add trainer</DialogTitle>
          <DialogDescription>
            Use this for a trainer who does not have a UsefulDesk team account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field id="trainer-name" label="Name">
            <Input
              id="trainer-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field id="trainer-title" label="Title or seniority">
            <Input
              id="trainer-title"
              value={title}
              placeholder="Senior trainer"
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter showCloseButton>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}Add
            independent trainer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RateMatrixDialog({
  selection,
  trainers,
  onOpenChange,
  accountId,
  onSaved,
}: {
  selection: {
    item: HydratedItem;
    option: HydratedItem['catalog_options'][number];
  } | null;
  trainers: Trainer[];
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const { locale } = useLocale();
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      selection?.option.trainer_rates
        .filter((rate) => rate.is_active)
        .map((rate) => [rate.trainer_id, String(rate.price)]) ?? []
    )
  );
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!selection || !accountId) return;
    const rows = trainers
      .filter(
        (trainer) => trainer.is_active && prices[trainer.id]?.trim() !== ''
      )
      .map((trainer) => ({
        account_id: accountId,
        trainer_id: trainer.id,
        option_id: selection.option.id,
        price: Number(prices[trainer.id]),
        is_active: true,
      }));
    if (rows.some((row) => !Number.isFinite(row.price) || row.price < 0))
      return toast.error('Enter valid trainer prices');
    const pricedTrainerIds = new Set(rows.map((row) => row.trainer_id));
    const ratesToArchive = selection.option.trainer_rates
      .filter(
        (rate) => rate.is_active && !pricedTrainerIds.has(rate.trainer_id)
      )
      .map((rate) => rate.id);
    setSaving(true);
    const { error: upsertError } = rows.length
      ? await supabase
          .from('trainer_rates')
          .upsert(rows, { onConflict: 'trainer_id,option_id' })
      : { error: null };
    const { data: archived, error: archiveError } = ratesToArchive.length
      ? await supabase
          .from('trainer_rates')
          .update({ is_active: false })
          .in('id', ratesToArchive)
          .select('id')
      : { data: [], error: null };
    setSaving(false);
    if (upsertError || archiveError) {
      return toast.error(
        upsertError?.message || archiveError?.message || 'Rates were not saved'
      );
    }
    if (ratesToArchive.length && archived?.length !== ratesToArchive.length) {
      return toast.error("You don't have permission to archive these rates");
    }
    toast.success('Trainer rates saved');
    onOpenChange(false);
    onSaved();
  }
  return (
    <Dialog open={!!selection} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trainer rate matrix</DialogTitle>
          <DialogDescription>
            {selection
              ? `${selection.item.name} · ${selection.option.duration_count} ${selection.option.duration_unit}${selection.option.duration_count === 1 ? '' : 's'}`
              : ''}
            . A blank rate is unavailable at checkout.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-80 space-y-3 overflow-y-auto px-1 py-1">
          {trainers
            .filter((trainer) => trainer.is_active)
            .map((trainer) => (
              <Field
                key={trainer.id}
                id={`trainer-rate-${trainer.id}`}
                label={`${trainer.display_name}${trainer.title ? ` · ${trainer.title}` : ''}`}
              >
                <CurrencyInput
                  id={`trainer-rate-${trainer.id}`}
                  symbol={currencySymbol(locale.currency)}
                  groupLocale={locale.locale}
                  placeholder="Rate missing"
                  value={prices[trainer.id] ?? ''}
                  onValueChange={(value) =>
                    setPrices((current) => ({
                      ...current,
                      [trainer.id]: value,
                    }))
                  }
                  className="tabular-nums"
                />
              </Field>
            ))}
        </div>
        <DialogFooter showCloseButton>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}Save
            rates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
