const RAZORPAY_SHORT_LINK_ORIGIN = 'https://rzp.io';

export function paymentLinkButtonParam(shortUrl: string): string {
  let url: URL;
  try {
    url = new URL(shortUrl);
  } catch {
    throw new Error(
      'Razorpay payment link URL is not supported by the WhatsApp template'
    );
  }
  const suffix = `${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`;
  if (url.origin !== RAZORPAY_SHORT_LINK_ORIGIN || !suffix) {
    throw new Error(
      'Razorpay payment link URL is not supported by the WhatsApp template'
    );
  }
  return suffix;
}
