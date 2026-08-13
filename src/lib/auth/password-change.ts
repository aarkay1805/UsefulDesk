export type PasswordChangeField = 'current' | 'next' | 'confirm';

export type PasswordChangeError = {
  message: string;
  fields: PasswordChangeField[];
};

export function validatePasswordChange(
  current: string,
  next: string,
  confirm: string,
  minimumLength: number
): PasswordChangeError | null {
  if (!current) {
    return {
      message: 'Enter your current password.',
      fields: ['current'],
    };
  }

  if (!next) {
    return {
      message: 'Enter a new password.',
      fields: ['next'],
    };
  }

  if (next.length < minimumLength) {
    return {
      message: `Use at least ${minimumLength} characters for your new password.`,
      fields: ['next'],
    };
  }

  if (!confirm) {
    return {
      message: 'Confirm your new password.',
      fields: ['confirm'],
    };
  }

  if (next !== confirm) {
    return {
      message: 'New passwords do not match.',
      fields: ['next', 'confirm'],
    };
  }

  return null;
}
