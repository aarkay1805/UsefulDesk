import crypto from 'node:crypto';

const META_LEADGEN_VERIFY_CONTEXT = 'usefuldesk:meta-leadgen:webhook-verify:v1';

interface MetaWebhookVerifyEnv {
  META_APP_SECRET?: string;
  META_LEADGEN_VERIFY_TOKEN?: string;
}

/**
 * Keep the provider handshake independently configurable, while allowing the
 * already-deployed Meta app secret to provide a stable, domain-separated
 * fallback when a dedicated verify token has not been provisioned yet.
 */
export function resolveMetaLeadgenVerifyToken(
  env: MetaWebhookVerifyEnv = process.env as MetaWebhookVerifyEnv
): string | null {
  const configured = env.META_LEADGEN_VERIFY_TOKEN?.trim();
  if (configured) return configured;

  const appSecret = env.META_APP_SECRET?.trim();
  if (!appSecret) return null;
  return crypto
    .createHmac('sha256', appSecret)
    .update(META_LEADGEN_VERIFY_CONTEXT)
    .digest('hex');
}
