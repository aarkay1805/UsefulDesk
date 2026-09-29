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
  onPayment: (result: CheckoutResult) => void;
}): Promise<void> {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_USEFULDESK_LIVE_CHECKOUT_UI !== 'true' ||
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
  new window.Razorpay({
    key: input.keyId,
    amount: input.amountMinor,
    currency: 'INR',
    order_id: input.orderId,
    name: 'UsefulDesk',
    description: `${input.planLabel} monthly plan · Usefulmade Live pilot`,
    handler: input.onPayment,
  }).open();
}
