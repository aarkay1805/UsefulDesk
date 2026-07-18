-- Note-created follow-ups historically only stored contact_id. Link those
-- records to the contact's membership so existing tasks appear in the member
-- Follow-ups tab. Memberships are unique per account/contact.
UPDATE public.follow_ups AS follow_up
SET membership_id = membership.id
FROM public.memberships AS membership
WHERE follow_up.membership_id IS NULL
  AND membership.account_id = follow_up.account_id
  AND membership.contact_id = follow_up.contact_id;
