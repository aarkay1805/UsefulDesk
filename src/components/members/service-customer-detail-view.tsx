'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, ShoppingBag } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/hooks/use-locale';
import type { Contact, Invoice, MemberService } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UserAvatar } from '@/components/ui/user-avatar';
import { ContactNotesThread } from '@/components/contacts/contact-notes-thread';
import { financeInvoiceReference } from '@/lib/finance/invoices';
import { MemberServiceStatusBadge } from './membership-status-badge';
import { MemberForm } from './member-form';
import { ProductServiceSaleDialog } from './product-service-sale-dialog';

export const SERVICE_CUSTOMER_SECTIONS = [
  'products',
  'billing',
  'notes',
] as const;

interface ServiceCustomerDetailViewProps {
  contactId: string;
  open: boolean;
  reloadKey?: number;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export function ServiceCustomerDetailView({
  contactId,
  open,
  reloadKey = 0,
  onOpenChange,
  onChanged,
}: ServiceCustomerDetailViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const { fmt } = useLocale();
  const [contact, setContact] = useState<Contact | null>(null);
  const [services, setServices] = useState<MemberService[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saleOpen, setSaleOpen] = useState(false);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!open || !contactId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const [contactResult, serviceResult, invoiceResult] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', contactId).maybeSingle(),
        supabase
          .from('member_service_details')
          .select('*')
          .eq('contact_id', contactId)
          .order('start_date', { ascending: false }),
        supabase
          .from('invoice_balances')
          .select('*')
          .eq('contact_id', contactId)
          .order('issued_at', { ascending: false }),
      ]);
      if (cancelled) return;
      const loadError =
        contactResult.error ?? serviceResult.error ?? invoiceResult.error;
      if (loadError || !contactResult.data) {
        setError(
          loadError?.message ?? 'Customer not found or no longer accessible.'
        );
        setLoading(false);
        return;
      }
      setContact(contactResult.data as Contact);
      setServices((serviceResult.data as MemberService[]) ?? []);
      setInvoices((invoiceResult.data as Invoice[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId, open, reloadKey, nonce, supabase]);

  function refresh() {
    setNonce((value) => value + 1);
    onChanged();
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-3xl">
          <SheetHeader className="border-border border-b">
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar
                name={contact?.name || '?'}
                src={contact?.avatar_url}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate">
                  {contact?.name || 'Service customer'}
                </SheetTitle>
                <SheetDescription>
                  {contact?.phone ||
                    contact?.email ||
                    'Contact-backed customer'}
                </SheetDescription>
              </div>
              {contact ? (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setMembershipOpen(true)}
                  >
                    <Plus className="size-4" />
                    Add membership
                  </Button>
                  <Button onClick={() => setSaleOpen(true)}>
                    <ShoppingBag className="size-4" />
                    Add purchase
                  </Button>
                </div>
              ) : null}
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {loading && !contact ? (
              <div className="text-muted-foreground flex items-center gap-2 py-12 text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading customer…
              </div>
            ) : error ? (
              <p className="text-destructive py-12 text-sm">{error}</p>
            ) : contact ? (
              <div className="space-y-6">
                <Card id="sec-products">
                  <CardHeader>
                    <CardTitle>Products &amp; services</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {services.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        No service purchases yet.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Service</TableHead>
                            <TableHead>Dates</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {services.map((service) => (
                            <TableRow key={service.id}>
                              <TableCell className="font-medium">
                                {service.item_name_snapshot}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {fmt.date(service.start_date)} –{' '}
                                {fmt.date(service.end_date)}
                              </TableCell>
                              <TableCell>
                                <MemberServiceStatusBadge
                                  status={service.derived_status}
                                />
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmt.money(service.sold_amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card id="sec-billing">
                  <CardHeader>
                    <CardTitle>Billing</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {invoices.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        No invoices yet.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice</TableHead>
                            <TableHead>Issued</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Due</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {invoices.map((invoice) => (
                            <TableRow key={invoice.id}>
                              <TableCell className="font-medium">
                                {financeInvoiceReference({
                                  id: invoice.id,
                                  invoice_number: null,
                                })}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {fmt.date(invoice.issued_at.slice(0, 10))}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmt.money(Number(invoice.total))}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmt.money(
                                  Number(
                                    invoice.collectible_balance ??
                                      invoice.balance
                                  )
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card id="sec-notes">
                  <CardHeader>
                    <CardTitle>Notes &amp; follow-ups</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ContactNotesThread
                      contactId={contact.id}
                      membershipId={null}
                      active={open}
                      onFollowUpChanged={refresh}
                    />
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {contact ? (
        <>
          <ProductServiceSaleDialog
            open={saleOpen}
            onOpenChange={setSaleOpen}
            contact={contact}
            membership={null}
            onSaved={refresh}
          />
          <MemberForm
            open={membershipOpen}
            onOpenChange={setMembershipOpen}
            member={null}
            seedContact={{
              id: contact.id,
              name: contact.name,
              phone: contact.phone,
              email: contact.email,
            }}
            onSaved={refresh}
          />
        </>
      ) : null}
    </>
  );
}
