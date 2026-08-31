export function createBranchAwareFetch(
  baseFetch: typeof fetch,
  getBranchId: () => string | null
): typeof fetch {
  return async (input, init = {}) => {
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined
    );
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });

    const branchId = getBranchId();
    if (branchId && !headers.has('x-usefuldesk-account-id')) {
      headers.set('x-usefuldesk-account-id', branchId);
    }

    return baseFetch(input, { ...init, headers });
  };
}
