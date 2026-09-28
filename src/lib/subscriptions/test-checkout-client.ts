type CheckoutResult = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type CheckoutConstructor = new (options: {
  key: string;
  amount: number;
  currency: 'INR';
  order_id: string;
  name: string;
  description: string;
  handler: (result: CheckoutResult) => void;
}) => { open: () => void };

declare global {
  interface Window {
    Razorpay?: CheckoutConstructor;
  }
}

export async function openUsefulDeskTestCheckout(input: {
  keyId: string;
  orderId: string;
  amountMinor: number;
  planLabel: string;
  onPayment: (result: CheckoutResult) => void;
}): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Test checkout is unavailable');
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
    description: `${input.planLabel} monthly plan · Test payment`,
    handler: input.onPayment,
  }).open();
}
