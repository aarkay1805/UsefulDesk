/**
 * Typed WhatsApp failure with a machine code and suggested HTTP status.
 * Kept free of server dependencies so client-safe conversation resolution
 * can share the contract without bundling the outbound-send pipeline.
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}
