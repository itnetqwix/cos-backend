-- The first chat trigger passed NEW."column" into a SQL statement.
-- PostgreSQL then looked for a column named "new" and every insert failed.
-- Copy the fields in PL/pgSQL first, then query with plain variables.

CREATE OR REPLACE FUNCTION "chat_participant_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    actor text;
    friendship_id text;
BEGIN
    friendship_id := NEW."friendshipId";
    IF TG_TABLE_NAME = 'chat_messages' THEN
        actor := NEW."senderId";
    ELSE
        actor := NEW."userId";
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "friendships" f
        WHERE f."id" = friendship_id
          AND f."status" = 'ACCEPTED'
          AND (f."userLowId" = actor OR f."userHighId" = actor)
    ) THEN
        RAISE EXCEPTION 'chat participant is not an accepted friend';
    END IF;
    RETURN NEW;
END;
$$;
