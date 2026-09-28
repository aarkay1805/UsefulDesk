import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_TIERS,
  type SubscriptionTier,
} from '@/lib/subscriptions/plans';

const PLAN_DETAILS: Record<SubscriptionTier, readonly string[]> = {
  starter: [
    '1 branch included',
    'Automatic renewal reminders at the standard times',
    'No extra branch option',
  ],
  growth: [
    '1 branch included; add 1 more for a monthly charge',
    'Choose reminder times, send bulk campaigns, and set automation rules',
    'Payment Links and AutoPay with your own ready Razorpay account',
  ],
  ultimate: [
    '5 branches included; add more for a monthly charge',
    'All Growth message and collection features',
    'Payment Links and AutoPay need your own ready Razorpay account',
  ],
};

export function SubscriptionPlanCards({
  showProvisionalPrices = false,
  formatMoney,
  onSelect,
  pendingTier,
}: {
  /** Keep false until commercial readiness, tax treatment, and billing terms are approved. */
  showProvisionalPrices?: boolean;
  formatMoney: (amount: number, currency: string) => string;
  onSelect?: (tier: SubscriptionTier) => void;
  pendingTier?: SubscriptionTier | null;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3" aria-label="UsefulDesk plans">
      {SUBSCRIPTION_TIERS.map((tier) => {
        const plan = SUBSCRIPTION_PLANS[tier];
        return (
          <Card key={tier} size="sm">
            <CardHeader>
              <CardTitle>{plan.label}</CardTitle>
              {tier === 'growth' ? (
                <CardAction>
                  <Badge variant="info">Recommended</Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {showProvisionalPrices ? (
                <p className="font-heading text-lg font-medium">
                  {formatMoney(plan.monthlySoftwareInr, 'INR')}/month
                </p>
              ) : null}
              <ul className="text-muted-foreground list-inside list-disc space-y-1 text-sm">
                {PLAN_DETAILS[tier].map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
              {onSelect ? (
                <Button
                  className="w-full"
                  loading={pendingTier === tier}
                  disabled={pendingTier !== null && pendingTier !== undefined}
                  onClick={() => onSelect(tier)}
                >
                  Choose {plan.label}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
      <p className="text-muted-foreground text-xs md:col-span-3">
        All plans have no UsefulDesk monthly message cap. WhatsApp message
        charges apply separately. Sending limits still apply.
      </p>
      {showProvisionalPrices ? (
        <p className="text-muted-foreground text-xs md:col-span-3">
          {onSelect
            ? 'Test payment only. No live charge will be made.'
            : 'These are planned software prices. The final amount and tax treatment are still being checked. Payment is not available yet.'}
        </p>
      ) : null}
    </div>
  );
}
