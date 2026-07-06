import { redirect } from 'next/navigation';

// Contacts merged into Leads (a lead IS a contact — see /leads).
// The route stays alive so old bookmarks and deep links keep working.
export default function ContactsRedirect() {
  redirect('/leads');
}
