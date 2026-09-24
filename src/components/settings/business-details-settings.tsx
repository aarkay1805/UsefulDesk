'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import {
  canEditLegalBusinessName,
  canEditOrganizationBrandName,
  canRenameBranch,
} from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import { loadLegalBusinessName } from '@/lib/whatsapp/legal-business-name';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InvoiceDetailsCard } from './invoice-details-card';
import { SettingsPanelHead, SettingsSectionHead } from './settings-panel-head';

export function BusinessDetailsSettings() {
  const {
    account,
    accountRole,
    branches,
    isOrganizationOwner,
    profileLoading,
    refreshProfile,
  } = useAuth();

  if (profileLoading || !account || !accountRole) return null;
  const currentBranch = branches.find(
    (branch) => branch.account_id === account.id
  );

  return (
    <BusinessDetailsForAccount
      key={account.id}
      accountId={account.id}
      gymBrandName={currentBranch?.organization_name ?? ''}
      branchName={account.name}
      mayEditBrand={canEditOrganizationBrandName(
        isOrganizationOwner ? 'owner' : null
      )}
      mayRename={canRenameBranch(accountRole)}
      mayEditLegalName={canEditLegalBusinessName(
        isOrganizationOwner ? 'owner' : null,
        accountRole
      )}
      refreshProfile={refreshProfile}
    />
  );
}

function BusinessDetailsForAccount({
  accountId,
  gymBrandName,
  branchName,
  mayEditBrand,
  mayRename,
  mayEditLegalName,
  refreshProfile,
}: {
  accountId: string;
  gymBrandName: string;
  branchName: string;
  mayEditBrand: boolean;
  mayRename: boolean;
  mayEditLegalName: boolean;
  refreshProfile: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [brandName, setBrandName] = useState(gymBrandName);
  const [name, setName] = useState(branchName);
  const [legalName, setLegalName] = useState('');
  const [savedLegalName, setSavedLegalName] = useState<string | null>(null);
  const [legalNameMissing, setLegalNameMissing] = useState(false);
  const [legalLoadError, setLegalLoadError] = useState(false);
  const [legalReloadNonce, setLegalReloadNonce] = useState(0);
  const [loadingLegalName, setLoadingLegalName] = useState(true);
  const [nameSaving, setNameSaving] = useState(false);
  const [brandSaving, setBrandSaving] = useState(false);
  const [legalSaving, setLegalSaving] = useState(false);
  const [invoiceRevision, setInvoiceRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const identity = await loadLegalBusinessName(
        supabase as unknown as Parameters<typeof loadLegalBusinessName>[0],
        accountId
      );
      if (cancelled) return;
      if (
        !identity.ok &&
        identity.code === 'legal_business_identity_lookup_unavailable'
      ) {
        setLegalLoadError(true);
      } else if (identity.ok) {
        setLegalLoadError(false);
        setLegalName(identity.name);
        setSavedLegalName(identity.name);
      } else {
        setLegalLoadError(false);
        setLegalNameMissing(true);
      }
      setLoadingLegalName(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, legalReloadNonce, supabase]);

  async function saveGymBrand() {
    const next = brandName.trim();
    if (!mayEditBrand || brandSaving || !next || Array.from(next).length > 80) {
      return;
    }
    setBrandSaving(true);
    try {
      const response = await fetch('/api/organization/brand', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        name?: string;
        error?: string;
      };
      if (!response.ok || typeof body.name !== 'string') {
        throw new Error(body.error || 'Gym brand was not saved.');
      }
      setBrandName(body.name);
      toast.success('Gym brand updated');
      await refreshProfile();
    } catch (error) {
      toast.error(getErrorMessage(error, "Gym brand couldn't be saved."));
    } finally {
      setBrandSaving(false);
    }
  }

  async function saveBranchName() {
    const next = name.trim();
    if (!mayRename || nameSaving || !next || Array.from(next).length > 80) {
      return;
    }
    setNameSaving(true);
    try {
      const response = await fetch(`/api/organization/branches/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', name: next }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error || 'Branch name was not saved.');
      toast.success('Branch name updated');
      window.location.reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "Branch name couldn't be saved."));
      setNameSaving(false);
    }
  }

  async function saveLegalName() {
    const next = legalName.trim();
    if (!mayEditLegalName || legalSaving || !next || next.length > 120) return;
    setLegalSaving(true);
    try {
      const { data, error } = await supabase.rpc('save_legal_business_name', {
        p_account_id: accountId,
        p_legal_name: next,
      });
      if (error) throw error;
      if (typeof data !== 'string')
        throw new Error('Legal name was not saved.');
      setLegalName(data);
      setSavedLegalName(data);
      setLegalNameMissing(false);
      setInvoiceRevision((current) => current + 1);
      toast.success('Legal business name updated');
      await refreshProfile();
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Legal business name couldn't be saved.")
      );
    } finally {
      setLegalSaving(false);
    }
  }

  const trimmedName = name.trim();
  const trimmedBrandName = brandName.trim();
  const trimmedLegalName = legalName.trim();

  return (
    <section className="max-w-2xl">
      <SettingsPanelHead
        title="Business details"
        description="See where each name appears for your gym, branch, messages, and invoices."
      />
      <div className="space-y-8">
        <section className="space-y-3" aria-labelledby="gym-brand-heading">
          <SettingsSectionHead
            id="gym-brand-heading"
            title="Gym brand"
            description="Shared by every branch in your gym group. Your team sees this name in the branch menu. Registered business and invoice names are set separately below."
          />
          <Card>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveGymBrand();
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="business-gym-brand">Gym brand</Label>
                  <Input
                    id="business-gym-brand"
                    value={brandName}
                    onChange={(event) => setBrandName(event.target.value)}
                    maxLength={80}
                    disabled={!mayEditBrand || brandSaving}
                  />
                </div>
                {!mayEditBrand ? (
                  <p className="text-muted-foreground text-sm">
                    Ask a gym group owner to change the brand.
                  </p>
                ) : null}
                <GatedButton
                  type="submit"
                  canAct={mayEditBrand}
                  gateReason="change the gym brand"
                  disabled={
                    !trimmedBrandName || trimmedBrandName === gymBrandName
                  }
                  loading={brandSaving}
                >
                  Save gym brand
                </GatedButton>
              </form>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3" aria-labelledby="branch-name-heading">
          <SettingsSectionHead
            id="branch-name-heading"
            title="Branch name"
            description="Only this branch. Your team sees it in the branch menu; changing it does not rename the gym brand, registered business, or past invoices."
          />
          <Card>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveBranchName();
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="business-branch-name">Branch name</Label>
                  <Input
                    id="business-branch-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                    disabled={!mayRename || nameSaving}
                  />
                </div>
                {!mayRename && (
                  <p className="text-muted-foreground text-sm">
                    Ask the branch owner to change this name.
                  </p>
                )}
                <GatedButton
                  type="submit"
                  canAct={mayRename}
                  gateReason="rename this branch"
                  disabled={!trimmedName || trimmedName === branchName}
                  loading={nameSaving}
                >
                  Save branch name
                </GatedButton>
              </form>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3" aria-labelledby="legal-name-heading">
          <SettingsSectionHead
            id="legal-name-heading"
            title="Legal business name"
            description="The name on your registration papers. It appears in WhatsApp messages and new invoices for every branch using this registered business. Issued invoices stay the same."
          />
          <Card>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveLegalName();
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="business-legal-name">
                    Legal business name
                  </Label>
                  <Input
                    id="business-legal-name"
                    value={legalName}
                    onChange={(event) => setLegalName(event.target.value)}
                    maxLength={120}
                    disabled={
                      !mayEditLegalName ||
                      legalSaving ||
                      loadingLegalName ||
                      legalLoadError
                    }
                  />
                </div>
                {legalLoadError ? (
                  <div className="space-y-2" role="alert">
                    <p className="text-destructive text-sm">
                      Registered business name could not be loaded.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setLoadingLegalName(true);
                        setLegalReloadNonce((current) => current + 1);
                      }}
                      loading={loadingLegalName}
                    >
                      Try again
                    </Button>
                  </div>
                ) : null}
                {!loadingLegalName && legalNameMissing ? (
                  <p className="text-amber-foreground text-sm">
                    Registered business name is not set. Enter the name on your
                    registration papers before issuing invoice documents or
                    sending business-named WhatsApp messages.
                  </p>
                ) : null}
                {!mayEditLegalName && (
                  <p className="text-muted-foreground text-sm">
                    Ask an owner of both this branch and the gym group to change
                    this name.
                  </p>
                )}
                <GatedButton
                  type="submit"
                  canAct={mayEditLegalName}
                  gateReason="change the registered business name"
                  disabled={
                    loadingLegalName ||
                    legalLoadError ||
                    !trimmedLegalName ||
                    trimmedLegalName === savedLegalName
                  }
                  loading={legalSaving}
                >
                  Save legal business name
                </GatedButton>
              </form>
            </CardContent>
          </Card>
        </section>

        <InvoiceDetailsCard key={`${accountId}-${invoiceRevision}`} />
      </div>
    </section>
  );
}
