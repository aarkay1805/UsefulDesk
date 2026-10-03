import {
  isMonthlyCatalogIdentity,
  type MonthlyCatalogIdentity,
} from './monthly-contract';
import { SUBSCRIPTION_PLANS } from './plans';
type CheckoutResult = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

/** Checkout stays unreachable while the Live order switches are hard-closed. */
export async function openUsefulmadeLiveCheckout(input: {
  keyId: string;
  orderId: string;
  amountMinor: number;
  planLabel: string;
  starterCustomer?: boolean;
  monthlyCustomer?: MonthlyCatalogIdentity;
  isCurrent?: () => boolean;
  onPayment: (result: CheckoutResult) => void;
}): Promise<void> {
  if (
    process.env.NODE_ENV !== 'production' ||
    (input.monthlyCustomer
      ? input.starterCustomer === true ||
        process.env.NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI !== 'true' ||
        !isMonthlyCatalogIdentity(input.monthlyCustomer) ||
        input.amountMinor !== input.monthlyCustomer.amountMinor ||
        input.planLabel !== SUBSCRIPTION_PLANS[input.monthlyCustomer.tier].label
      : input.starterCustomer
        ? process.env.NEXT_PUBLIC_USEFULDESK_CUSTOMER_CHECKOUT_UI !== 'true' ||
          input.amountMinor !== 79900 ||
          input.planLabel !== 'Starter'
        : process.env.NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI !== 'true') ||
    !/^rzp_live_[A-Za-z0-9]+$/.test(input.keyId) ||
    !/^order_[A-Za-z0-9]+$/.test(input.orderId) ||
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor < 1
  )
    throw new Error('Live payment is unavailable');
  if (!window.Razorpay) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load payment window'));
      document.head.appendChild(script);
    });
  }
  if (!window.Razorpay) throw new Error('Could not load payment window');
  if (
    input.isCurrent?.() === false ||
    (input.monthlyCustomer &&
      process.env.NEXT_PUBLIC_USEFULDESK_MONTHLY_CHECKOUT_UI !== 'true')
  )
    throw new Error('Live payment is unavailable');
  new window.Razorpay({
    key: input.keyId,
    amount: input.amountMinor,
    currency: 'INR',
    order_id: input.orderId,
    name: 'UsefulDesk',
    description:
      input.starterCustomer || input.monthlyCustomer
        ? `${input.planLabel} monthly plan`
        : `${input.planLabel} monthly plan · Usefulmade Live pilot`,
    handler: input.onPayment,
  }).open();
}
