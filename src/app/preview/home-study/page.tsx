import { notFound } from 'next/navigation';
import { HomeStudy } from './study';

/** Fictional, local-only research surface; never exposed by a production build. */
export default function HomeStudyPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <HomeStudy />;
}
