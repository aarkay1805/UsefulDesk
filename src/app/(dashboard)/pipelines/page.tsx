import { redirect } from 'next/navigation';

// Pipelines is deprecated — its kanban lives on as the Leads board
// view (columns = lead statuses). The deals/pipelines tables remain
// in the database untouched; only the UI was retired.
export default function PipelinesRedirect() {
  redirect('/leads');
}
