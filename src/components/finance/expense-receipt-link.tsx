'use client';

import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/errors';
import { createPrivateMediaUrl } from '@/lib/storage/upload-media';

const SIGNED_URL_REUSE_MS = 4 * 60 * 1000;

export function ExpenseReceiptLink({
  expense,
}: {
  expense: {
    id: string;
    receipt_path: string | null;
    receipt_bucket: string | null;
  };
}) {
  const [signed, setSigned] = useState<{ url: string; at: number } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  if (!expense.receipt_path || !expense.receipt_bucket) return null;

  async function openReceipt() {
    if (signed && Date.now() - signed.at < SIGNED_URL_REUSE_MS) {
      window.open(signed.url, '_blank', 'noopener,noreferrer');
      return;
    }

    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setLoading(true);
    try {
      const url = await createPrivateMediaUrl(
        expense.receipt_bucket!,
        expense.receipt_path!
      );
      setSigned({ url, at: Date.now() });
      if (popup) popup.location.href = url;
      else
        toast.info(
          'Receipt link ready. Select the receipt action again to open it.'
        );
    } catch (reason) {
      popup?.close();
      toast.error(getErrorMessage(reason, 'Could not open expense receipt'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void openReceipt()}
      disabled={loading}
      aria-label="View expense receipt"
      title="View expense receipt"
    >
      {loading ? <Loader2 className="animate-spin" /> : <ExternalLink />}
      View
    </Button>
  );
}
