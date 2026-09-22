import { NextResponse } from 'next/server';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';
import {
  createTemplateForReview,
  TemplateSubmissionError,
} from '@/lib/whatsapp/template-submission-server';

/** Submit one custom or canonical template to Meta for individual review. */
export async function POST(request: Request) {
  let context;
  try {
    context = await requireSettingsAccess();
  } catch (error) {
    return toErrorResponse(error);
  }

  let payload: TemplatePayload;
  try {
    payload = (await request.json()) as TemplatePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const result = await createTemplateForReview({ ...context, payload });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error submitting template:', error);
    if (error instanceof TemplateSubmissionError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          meta_template_id: error.metaTemplateId,
        },
        { status: error.status }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 }
    );
  }
}
