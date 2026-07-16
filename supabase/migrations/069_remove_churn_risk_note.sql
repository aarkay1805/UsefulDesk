-- Keep retention context in the existing member Notes section before
-- removing the redundant churn-risk note field. The legacy field did not
-- record an author, so prefer the contact creator and otherwise use an
-- active account member for the required contact_notes attribution.

INSERT INTO contact_notes (contact_id, user_id, note_text, account_id)
SELECT
  contact.id,
  note_author.user_id,
  contact.churn_risk_note,
  contact.account_id
FROM contacts AS contact
JOIN LATERAL (
  SELECT profile.user_id
  FROM profiles AS profile
  JOIN auth.users AS auth_user ON auth_user.id = profile.user_id
  WHERE profile.account_id = contact.account_id
  ORDER BY
    CASE WHEN profile.user_id = contact.created_by THEN 0 ELSE 1 END,
    CASE profile.role::text
      WHEN 'owner' THEN 0
      WHEN 'admin' THEN 1
      WHEN 'agent' THEN 2
      ELSE 3
    END,
    profile.created_at
  LIMIT 1
) AS note_author ON TRUE
WHERE NULLIF(BTRIM(contact.churn_risk_note), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM contact_notes AS existing_note
    WHERE existing_note.contact_id = contact.id
      AND existing_note.note_text = contact.churn_risk_note
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM contacts AS contact
    WHERE NULLIF(BTRIM(contact.churn_risk_note), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM contact_notes AS migrated_note
        WHERE migrated_note.contact_id = contact.id
          AND migrated_note.note_text = contact.churn_risk_note
      )
  ) THEN
    RAISE EXCEPTION 'Cannot remove churn_risk_note until every note is preserved in contact_notes';
  END IF;
END
$$;

ALTER TABLE contacts
  DROP COLUMN IF EXISTS churn_risk_note;
