CREATE SEQUENCE IF NOT EXISTS messages_event_position_seq AS BIGINT;

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS event_position BIGINT;

WITH ordered_messages AS (
    SELECT
        message_id,
        ROW_NUMBER() OVER (ORDER BY created_at ASC, message_id ASC) AS next_position
    FROM messages
    WHERE event_position IS NULL
)
UPDATE messages
SET event_position = ordered_messages.next_position
FROM ordered_messages
WHERE messages.message_id = ordered_messages.message_id;

SELECT setval(
    'messages_event_position_seq',
    COALESCE((SELECT MAX(event_position) FROM messages), 1),
    EXISTS(SELECT 1 FROM messages)
);

ALTER TABLE messages
ALTER COLUMN event_position SET DEFAULT nextval('messages_event_position_seq'),
ALTER COLUMN event_position SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_event_position
    ON messages(event_position);
