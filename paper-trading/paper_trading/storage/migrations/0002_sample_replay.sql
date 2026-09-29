-- 0002_sample_replay: Step 4 sample-data mode (fixtures, replay state, quote intake audit).
-- Adds tables and guards only; 0001 is never edited.

-- Stored fixture content. Replay reads from here, not from the file on disk,
-- so a later edit to the file cannot change an in-progress replay.
CREATE TABLE fixtures (
    fixture_id              TEXT NOT NULL CHECK (length(fixture_id) > 0),
    fixture_version         TEXT NOT NULL CHECK (length(fixture_version) > 0),
    checksum                TEXT NOT NULL UNIQUE CHECK (checksum LIKE 'sha256:%' AND length(checksum) = 71),
    fixture_schema_version  TEXT NOT NULL CHECK (fixture_schema_version = '1.0'),
    source                  TEXT NOT NULL CHECK (source = 'synthetic_fixture_v1'),
    is_sample               INTEGER NOT NULL CHECK (is_sample = 1),
    session_timezone        TEXT NOT NULL CHECK (session_timezone = 'America/New_York'),
    session_start           TEXT NOT NULL,
    session_end             TEXT NOT NULL,
    session_reference_cents INTEGER NOT NULL CHECK (session_reference_cents > 0),
    event_count             INTEGER NOT NULL CHECK (event_count >= 2),
    content_json            TEXT NOT NULL CHECK (json_valid(content_json)),
    stored_at               TEXT NOT NULL,
    PRIMARY KEY (fixture_id, fixture_version),
    CHECK (session_end > session_start)
) STRICT;

-- One replay cursor per run. next_position is the 1-based index of the next
-- fixture event; it is the replay checkpoint.
CREATE TABLE replay_state (
    run_id          TEXT PRIMARY KEY REFERENCES runs(run_id),
    fixture_id      TEXT NOT NULL,
    fixture_version TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('ACTIVE','PAUSED','EXHAUSTED')),
    next_position   INTEGER NOT NULL CHECK (next_position >= 1),
    total_events    INTEGER NOT NULL CHECK (total_events >= 1),
    loaded_at       TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (fixture_id, fixture_version) REFERENCES fixtures(fixture_id, fixture_version),
    CHECK (next_position <= total_events + 1),
    CHECK ((status = 'EXHAUSTED') = (next_position = total_events + 1))
) STRICT;

-- Raw inputs that failed validation. Kept apart from market_quotes so a
-- rejected input can never become (or overwrite) valid market state.
CREATE TABLE rejected_inputs (
    rejection_id      TEXT PRIMARY KEY CHECK (length(rejection_id) > 0),
    run_id            TEXT NOT NULL REFERENCES runs(run_id),
    event_sequence    INTEGER NOT NULL CHECK (event_sequence >= 1),
    replay_position   INTEGER NOT NULL CHECK (replay_position >= 1),
    received_at       TEXT NOT NULL,
    source            TEXT,
    source_sequence   INTEGER,
    contract_id       TEXT,
    raw_input_json    TEXT NOT NULL CHECK (json_valid(raw_input_json)),
    reason_codes_json TEXT NOT NULL CHECK (json_valid(reason_codes_json)
                                           AND json_type(reason_codes_json) = 'array'
                                           AND json_array_length(reason_codes_json) > 0),
    UNIQUE (run_id, replay_position),
    UNIQUE (run_id, event_sequence),
    FOREIGN KEY (run_id, event_sequence) REFERENCES run_events(run_id, event_sequence)
) STRICT;

-- The committed result of each replayed fixture event, exactly one per position.
CREATE TABLE replay_events (
    run_id          TEXT NOT NULL REFERENCES runs(run_id),
    replay_position INTEGER NOT NULL CHECK (replay_position >= 1),
    event_sequence  INTEGER NOT NULL CHECK (event_sequence >= 1),
    event_type      TEXT NOT NULL CHECK (event_type IN ('SESSION_OPEN','SESSION_CLOSE','QUOTE')),
    fixture_ref     TEXT,
    scheduled_at    TEXT NOT NULL,
    outcome         TEXT NOT NULL CHECK (outcome IN ('BOUNDARY','ACCEPTED','REJECTED')),
    quote_id        TEXT UNIQUE REFERENCES market_quotes(quote_id),
    rejection_id    TEXT UNIQUE REFERENCES rejected_inputs(rejection_id),
    PRIMARY KEY (run_id, replay_position),
    UNIQUE (run_id, event_sequence),
    FOREIGN KEY (run_id, event_sequence) REFERENCES run_events(run_id, event_sequence),
    CHECK ((outcome = 'BOUNDARY' AND event_type <> 'QUOTE' AND quote_id IS NULL AND rejection_id IS NULL)
        OR (outcome = 'ACCEPTED' AND event_type = 'QUOTE' AND quote_id IS NOT NULL AND rejection_id IS NULL)
        OR (outcome = 'REJECTED' AND event_type = 'QUOTE' AND quote_id IS NULL AND rejection_id IS NOT NULL))
) STRICT;

CREATE INDEX ix_quotes_run_contract_event ON market_quotes(run_id, contract_id, event_sequence);

-- Immutability of reference data and audit records.
CREATE TRIGGER tr_fixtures_no_update BEFORE UPDATE ON fixtures
BEGIN SELECT RAISE(ABORT, 'stored fixtures are immutable; publish a new fixture version'); END;
CREATE TRIGGER tr_fixtures_no_delete BEFORE DELETE ON fixtures
BEGIN SELECT RAISE(ABORT, 'stored fixtures are immutable'); END;
CREATE TRIGGER tr_contracts_no_update BEFORE UPDATE ON option_contracts
BEGIN SELECT RAISE(ABORT, 'option contracts are immutable'); END;
CREATE TRIGGER tr_contracts_no_delete BEFORE DELETE ON option_contracts
BEGIN SELECT RAISE(ABORT, 'option contracts are immutable'); END;
CREATE TRIGGER tr_quotes_no_update BEFORE UPDATE ON market_quotes
BEGIN SELECT RAISE(ABORT, 'market quotes are immutable'); END;
CREATE TRIGGER tr_quotes_no_delete BEFORE DELETE ON market_quotes
BEGIN SELECT RAISE(ABORT, 'market quotes are immutable'); END;
CREATE TRIGGER tr_rejected_no_update BEFORE UPDATE ON rejected_inputs
BEGIN SELECT RAISE(ABORT, 'rejected inputs are immutable'); END;
CREATE TRIGGER tr_rejected_no_delete BEFORE DELETE ON rejected_inputs
BEGIN SELECT RAISE(ABORT, 'rejected inputs are immutable'); END;
CREATE TRIGGER tr_replay_events_no_update BEFORE UPDATE ON replay_events
BEGIN SELECT RAISE(ABORT, 'replay events are immutable'); END;
CREATE TRIGGER tr_replay_events_no_delete BEFORE DELETE ON replay_events
BEGIN SELECT RAISE(ABORT, 'replay events are immutable'); END;

-- Replay positions are contiguous per run and match the cursor.
CREATE TRIGGER tr_replay_events_contiguous BEFORE INSERT ON replay_events
BEGIN
    SELECT RAISE(ABORT, 'replay_position must be contiguous')
    WHERE NEW.replay_position <> 1 + COALESCE(
        (SELECT MAX(replay_position) FROM replay_events WHERE run_id = NEW.run_id), 0);
    SELECT RAISE(ABORT, 'replay_position must equal the replay cursor')
    WHERE NEW.replay_position <> (SELECT next_position FROM replay_state WHERE run_id = NEW.run_id);
END;

-- Replay cursor: fixture binding fixed, advances by at most one, EXHAUSTED is final.
CREATE TRIGGER tr_replay_state_rules BEFORE UPDATE ON replay_state
BEGIN
    SELECT RAISE(ABORT, 'replay fixture binding is immutable')
    WHERE NEW.fixture_id IS NOT OLD.fixture_id OR NEW.fixture_version IS NOT OLD.fixture_version
       OR NEW.total_events IS NOT OLD.total_events OR NEW.run_id IS NOT OLD.run_id;
    SELECT RAISE(ABORT, 'replay cursor may only advance one event at a time')
    WHERE NEW.next_position NOT IN (OLD.next_position, OLD.next_position + 1);
    SELECT RAISE(ABORT, 'exhausted replay is final')
    WHERE OLD.status = 'EXHAUSTED';
END;
CREATE TRIGGER tr_replay_state_no_delete BEFORE DELETE ON replay_state
BEGIN SELECT RAISE(ABORT, 'replay state cannot be deleted'); END;

-- A run's fixture, once pinned, never changes (any status). Replacing it requires a new run.
CREATE TRIGGER tr_runs_fixture_set_once BEFORE UPDATE ON runs
WHEN OLD.fixture_checksum IS NOT NULL
 AND (NEW.fixture_id IS NOT OLD.fixture_id OR NEW.fixture_version IS NOT OLD.fixture_version
      OR NEW.fixture_checksum IS NOT OLD.fixture_checksum
      OR NEW.session_reference_cents IS NOT OLD.session_reference_cents)
BEGIN SELECT RAISE(ABORT, 'run fixture is pinned; create a new run to use a different fixture'); END;

-- The simulated clock and checkpoint never move backward.
CREATE TRIGGER tr_runs_clock_monotonic BEFORE UPDATE OF simulated_clock, checkpoint_event_sequence ON runs
BEGIN
    SELECT RAISE(ABORT, 'simulated clock cannot move backward')
    WHERE julianday(NEW.simulated_clock) < julianday(OLD.simulated_clock);
    SELECT RAISE(ABORT, 'checkpoint cannot move backward')
    WHERE NEW.checkpoint_event_sequence < OLD.checkpoint_event_sequence;
END;
