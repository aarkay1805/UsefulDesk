import 'server-only';

import { NextResponse } from 'next/server';

interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

/** Map the documented branch-setup SQL contract without leaking unknown SQL. */
export function branchSetupRpcErrorResponse(
  error: RpcErrorLike,
  fallback: string
): NextResponse {
  if (error.code === '42501') {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: 403 }
    );
  }
  if (error.code === '23505') {
    return NextResponse.json(
      { error: error.message || 'Request conflict' },
      { status: 409 }
    );
  }
  if (error.code === '22023' || error.code === '54000') {
    return NextResponse.json(
      { error: error.message || 'Invalid branch setup request' },
      { status: 400 }
    );
  }
  console.error('[branch setup] unexpected RPC error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
