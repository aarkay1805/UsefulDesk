import { NextResponse } from 'next/server';
import { requireSettingsAccess, toErrorResponse } from '@/lib/auth/account';
import { runRequiredTemplateSubmission } from '@/lib/whatsapp/required-template-submission-server';

export async function POST() {
  let context;
  try {
    context = await requireSettingsAccess();
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const summary = await runRequiredTemplateSubmission(context);
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error('Error submitting required templates:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Could not submit required templates.',
      },
      { status: 500 }
    );
  }
}
