'use client';

import { useState } from 'react';

import type {
  CheckoutMode,
  CheckoutSelection,
  Contact,
  Membership,
} from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProductServiceSaleCheckout } from './product-service-sale-checkout';

export function ProductServiceSaleDialog({
  open,
  onOpenChange,
  contact,
  membership,
  onSaved,
  mode = 'sale',
  initialSelections = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact;
  membership?: Membership | null;
  onSaved: () => void;
  mode?: Extract<CheckoutMode, 'sale' | 'service_renewal'>;
  initialSelections?: CheckoutSelection[];
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving || next) onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[min(92vh,820px)] flex-col sm:max-w-2xl lg:max-w-[min(1040px,calc(100vw-2rem))]">
        <DialogHeader className="shrink-0">
          <DialogTitle size="lg">
            {mode === 'service_renewal' ? 'Renew service' : 'Add purchase'}
          </DialogTitle>
          <DialogDescription>
            Set quantities, then choose what to collect.
            {membership ? ' Member credit is applied automatically.' : ''}
          </DialogDescription>
        </DialogHeader>
        <ProductServiceSaleCheckout
          contact={contact}
          membership={membership}
          mode={mode}
          initialSelections={initialSelections}
          onSavingChange={setSaving}
          onCancel={() => onOpenChange(false)}
          onSaved={() => {
            onOpenChange(false);
            onSaved();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
