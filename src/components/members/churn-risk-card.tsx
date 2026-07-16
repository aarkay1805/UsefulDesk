'use client';

import { useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { getErrorMessage } from '@/lib/errors';
import { createClient } from '@/lib/supabase/client';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ChurnRiskCardProps {
  contactId: string;
  churnRisk: boolean | null | undefined;
  canEdit: boolean;
  onSaved: () => void;
}

export function ChurnRiskCard({
  contactId,
  churnRisk,
  canEdit,
  onSaved,
}: ChurnRiskCardProps) {
  const supabase = createClient();
  const [risk, setRisk] = useState(Boolean(churnRisk));
  const [savingRisk, setSavingRisk] = useState(false);

  async function updateRisk(next: boolean) {
    const previous = risk;
    setRisk(next);
    setSavingRisk(true);

    const { data, error } = await supabase
      .from('contacts')
      .update({ churn_risk: next })
      .eq('id', contactId)
      .select('id')
      .maybeSingle();

    setSavingRisk(false);

    if (error || !data) {
      setRisk(previous);
      toast.error(getErrorMessage(error, 'Failed to update churn risk'));
      return;
    }

    toast.success(next ? 'Marked as churn risk' : 'Churn risk cleared');
    onSaved();
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Churn risk
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="What churn risk means"
                  className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-5 cursor-help items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
                />
              }
            >
              <Info aria-hidden="true" className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-pretty">
              Churn risk flags a member who may cancel or not renew, helping
              your team prioritise retention follow-up.
            </TooltipContent>
          </Tooltip>
        </CardTitle>
        <CardAction className="flex items-center gap-2">
          {savingRisk && (
            <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
          )}
          <Switch
            checked={risk}
            onCheckedChange={updateRisk}
            disabled={!canEdit || savingRisk}
            aria-label="Churn risk"
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">
          {risk
            ? 'This member is marked for retention follow-up.'
            : 'This member is not marked as a churn risk.'}
        </p>
      </CardContent>
    </Card>
  );
}
