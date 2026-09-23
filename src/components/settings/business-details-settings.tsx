'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { canEditLegalBusinessName, canRenameBranch } from '@/lib/auth/roles';
import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InvoiceDetailsCard } from './invoice-details-card';
import { SettingsPanelHead, SettingsSectionHead } from './settings-panel-head';

export function BusinessDetailsSettings() {
  const { account, accountRole, isOrganizationOwner, profileLoading } =
    useAuth();

  if (profileLoading || !account || !accountRole) return null;

  return (
    <BusinessDetailsForAccount
      key={account.id}
      accountId={account.id}
      gymName={account.name}
      mayRename={canRenameBranch(accountRole)}
      mayEditLegalName={canEditLegalBusinessName(
        isOrganizationOwner ? 'owner' : null,
        accountRole
      )}
    />
  );
}

function BusinessDetailsForAccount({
  accountId,
  gymName,
  mayRename,
  mayEditLegalName,
}: {
  accountId: string;
  gymName: string;
  mayRename: boolean;
  mayEditLegalName: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState(gymName);
  const [legalName, setLegalName] = useState('');
  const [savedLegalName, setSavedLegalName] = useState<string | null>(null);
  const [loadingLegalName, setLoadingLegalName] = useState(true);
  const [nameSaving, setNameSaving] = useState(false);
  const [legalSaving, setLegalSaving] = useState(false);
  const [invoiceRevision, setInvoiceRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc(
        'get_invoice_profile_prefill',
        {
          p_account_id: accountId,
        }
      );
      if (cancelled) return;
      if (error) {
        toast.error(getErrorMessage(error, "Business details couldn't load."));
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        const value = typeof row?.legal_name === 'string' ? row.legal_name : '';
        setLegalName(value);
        setSavedLegalName(value);
      }
      setLoadingLegalName(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  async function saveGymName() {
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
        throw new Error(body.error || 'Gym name was not saved.');
      toast.success('Gym name updated');
      window.location.reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "Gym name couldn't be saved."));
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
      setInvoiceRevision((current) => current + 1);
      toast.success('Legal business name updated');
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Legal business name couldn't be saved.")
      );
    } finally {
      setLegalSaving(false);
    }
  }

  const trimmedName = name.trim();
  const trimmedLegalName = legalName.trim();

  return (
    <section className="max-w-2xl">
      <SettingsPanelHead
        title="Business details"
        description="Set the gym and business names used across UsefulDesk."
      />
      <div className="space-y-8">
        <section className="space-y-3" aria-labelledby="gym-name-heading">
          <SettingsSectionHead
            id="gym-name-heading"
            title="Gym name"
            description="Your team sees this name in the branch menu. Set the name on invoices below."
          />
          <Card>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveGymName();
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="business-gym-name">Gym name</Label>
                  <Input
                    id="business-gym-name"
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
                <Button
                  type="submit"
                  disabled={
                    !mayRename || !trimmedName || trimmedName === gymName
                  }
                  loading={nameSaving}
                >
                  Save gym name
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3" aria-labelledby="legal-name-heading">
          <SettingsSectionHead
            id="legal-name-heading"
            title="Legal business name"
            description="Use the name on your registration papers. It appears in WhatsApp messages and new invoices. If branches share this business, the change applies to all of them. Old invoices stay the same."
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
                      !mayEditLegalName || legalSaving || loadingLegalName
                    }
                  />
                </div>
                {!mayEditLegalName && (
                  <p className="text-muted-foreground text-sm">
                    Ask an owner of both this branch and the gym group to change
                    this name.
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={
                    !mayEditLegalName ||
                    loadingLegalName ||
                    !trimmedLegalName ||
                    trimmedLegalName === savedLegalName
                  }
                  loading={legalSaving}
                >
                  Save legal business name
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>

        <InvoiceDetailsCard key={`${accountId}-${invoiceRevision}`} />
      </div>
    </section>
  );
}
