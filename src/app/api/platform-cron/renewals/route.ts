import { runVercelCron } from '@/lib/cron/vercel-scheduler';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  return runVercelCron(request, 'renewals');
}
