"""Migration 0004: datasets, data classes, and quote provenance times (FA-1a).

1. New immutable tables:
   - ``dataset_manifests``: provenance documents, keyed by their checksum;
   - ``datasets``: one sealed header per (dataset_id, dataset_version);
   - ``dataset_events``: the ordered event stream, read one row at a time
     during replay (primary key lookups instead of re-parsing a document).
2. Rebuilt tables (SQLite cannot change a CHECK constraint in place; this is
   SQLite's documented create-copy-drop-rename procedure, run with foreign keys
   off and verified with ``PRAGMA foreign_key_check`` before commit):
   - ``runs``: ``mode`` may be SAMPLE_PAPER (synthetic data) or
     HISTORICAL_PAPER (historical data); ``is_sample`` must agree with it.
   - ``market_quotes``: ``is_sample`` may be 0 or 1 but must equal its run's
     (columns unchanged).
   - ``replay_state``: references ``datasets`` instead of ``fixtures``.
   Every column, row, index, and trigger of the rebuilt tables is preserved;
   triggers are recreated with their original text.
3. Two indexes so the entry-rejection cooldown reads only recent rows.
4. ``quote_provenance``: optional ``snapshot_at`` / ``ingested_at`` times for an
   accepted quote, neither of which may precede its ``observed_at`` (kept in a
   side table so ``market_quotes`` keeps its Step 7 column layout).
5. Backfill: every stored synthetic fixture becomes a SYNTHETIC dataset with a
   manifest, so existing runs keep replaying from the same content.

Self-contained on purpose (standard library only): application code may change
later, but an applied migration must always mean the same thing.
"""

import hashlib
import json
import sqlite3

REQUIRES_FOREIGN_KEYS_OFF = True

SHA = "LIKE 'sha256:%' AND length({0}) = 71"
TS = "LIKE '____-__-__T__:__:__%Z'"

NEW_TABLES = f"""
CREATE TABLE dataset_manifests (
    manifest_checksum TEXT PRIMARY KEY CHECK (manifest_checksum {SHA.format('manifest_checksum')}),
    dataset_id        TEXT NOT NULL CHECK (length(dataset_id) > 0),
    dataset_version   TEXT NOT NULL CHECK (length(dataset_version) > 0),
    data_class        TEXT NOT NULL CHECK (data_class IN ('SYNTHETIC','HISTORICAL')),
    manifest_json     TEXT NOT NULL CHECK (json_valid(manifest_json) AND json_type(manifest_json) = 'object'),
    stored_at         TEXT NOT NULL,
    CHECK (json_extract(manifest_json, '$.data_class') = data_class
       AND json_extract(manifest_json, '$.dataset_id') = dataset_id
       AND json_extract(manifest_json, '$.dataset_version') = dataset_version),
    -- A synthetic manifest names its generator and never carries fields that
    -- describe real-world observations.
    CHECK (data_class <> 'SYNTHETIC' OR (
               json_type(manifest_json, '$.generator') = 'object'
           AND json_type(manifest_json, '$.vendor') IS NULL
           AND json_type(manifest_json, '$.vendor_dataset') IS NULL
           AND json_type(manifest_json, '$.raw_files') IS NULL
           AND json_type(manifest_json, '$.retrieved_at') IS NULL
           AND json_type(manifest_json, '$.license_reference') IS NULL
           AND json_type(manifest_json, '$.importer') IS NULL)),
    -- A historical manifest must name its importer, vendor, raw files,
    -- retrieval time, and license, and has no synthetic generator.
    CHECK (data_class <> 'HISTORICAL' OR (
               json_type(manifest_json, '$.importer') = 'object'
           AND json_type(manifest_json, '$.vendor') = 'text'
           AND json_type(manifest_json, '$.vendor_dataset') = 'text'
           AND json_type(manifest_json, '$.raw_files') = 'array'
           AND json_array_length(manifest_json, '$.raw_files') > 0
           AND json_type(manifest_json, '$.retrieved_at') = 'text'
           AND json_type(manifest_json, '$.license_reference') = 'text'
           AND json_type(manifest_json, '$.generator') IS NULL))
) STRICT;

CREATE TRIGGER tr_manifests_no_update BEFORE UPDATE ON dataset_manifests
BEGIN SELECT RAISE(ABORT, 'dataset manifests are immutable'); END;
CREATE TRIGGER tr_manifests_no_delete BEFORE DELETE ON dataset_manifests
BEGIN SELECT RAISE(ABORT, 'dataset manifests are immutable'); END;

CREATE TABLE dataset_events (
    dataset_id      TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    position        INTEGER NOT NULL CHECK (position >= 1),
    event_type      TEXT NOT NULL CHECK (event_type IN ('SESSION_OPEN','QUOTE','SESSION_CLOSE')),
    at              TEXT NOT NULL CHECK (at {TS}),
    ref             TEXT,
    input_json      TEXT CHECK (input_json IS NULL OR json_valid(input_json)),
    CHECK ((event_type = 'QUOTE') = (input_json IS NOT NULL)),
    PRIMARY KEY (dataset_id, dataset_version, position),
    FOREIGN KEY (dataset_id, dataset_version) REFERENCES datasets(dataset_id, dataset_version)
        DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;

-- Events are written first, in order, then sealed by inserting the dataset header.
CREATE TRIGGER tr_dataset_events_append BEFORE INSERT ON dataset_events
BEGIN
    SELECT RAISE(ABORT, 'dataset is sealed; publish a new dataset_version')
    WHERE EXISTS (SELECT 1 FROM datasets
                   WHERE dataset_id = NEW.dataset_id AND dataset_version = NEW.dataset_version);
    SELECT RAISE(ABORT, 'dataset event positions must be contiguous from 1')
    WHERE NEW.position <> 1 + COALESCE(
        (SELECT MAX(position) FROM dataset_events
          WHERE dataset_id = NEW.dataset_id AND dataset_version = NEW.dataset_version), 0);
    SELECT RAISE(ABORT, 'dataset event times must be non-decreasing')
    WHERE NEW.position > 1 AND julianday(NEW.at) < julianday(
        (SELECT at FROM dataset_events WHERE dataset_id = NEW.dataset_id
            AND dataset_version = NEW.dataset_version AND position = NEW.position - 1));
END;
CREATE TRIGGER tr_dataset_events_no_update BEFORE UPDATE ON dataset_events
BEGIN SELECT RAISE(ABORT, 'dataset events are immutable'); END;
CREATE TRIGGER tr_dataset_events_no_delete BEFORE DELETE ON dataset_events
BEGIN SELECT RAISE(ABORT, 'dataset events are immutable'); END;

CREATE TABLE datasets (
    dataset_id              TEXT NOT NULL CHECK (length(dataset_id) > 0),
    dataset_version         TEXT NOT NULL CHECK (length(dataset_version) > 0),
    checksum                TEXT NOT NULL UNIQUE CHECK (checksum {SHA.format('checksum')}),
    checksum_scheme         TEXT NOT NULL CHECK (checksum_scheme IN ('fixture_document_v1','event_stream_v1')),
    events_digest           TEXT NOT NULL CHECK (events_digest {SHA.format('events_digest')}),
    data_class              TEXT NOT NULL CHECK (data_class IN ('SYNTHETIC','HISTORICAL')),
    source                  TEXT NOT NULL CHECK (length(source) > 0),
    label                   TEXT NOT NULL CHECK (length(label) > 0),
    underlying              TEXT NOT NULL CHECK (underlying = 'SPY'),
    session_timezone        TEXT NOT NULL CHECK (session_timezone = 'America/New_York'),
    session_start           TEXT NOT NULL CHECK (session_start {TS}),
    session_end             TEXT NOT NULL CHECK (session_end {TS}),
    session_reference_cents INTEGER NOT NULL CHECK (session_reference_cents > 0),
    calendar_id             TEXT,
    contracts_json          TEXT NOT NULL CHECK (json_valid(contracts_json) AND json_type(contracts_json) = 'array'
                                                 AND json_array_length(contracts_json) > 0),
    event_count             INTEGER NOT NULL CHECK (event_count >= 2),
    manifest_checksum       TEXT NOT NULL REFERENCES dataset_manifests(manifest_checksum),
    stored_at               TEXT NOT NULL,
    PRIMARY KEY (dataset_id, dataset_version),
    CHECK (julianday(session_end) > julianday(session_start)),
    -- The label and source must tell the truth about the data class.
    CHECK ((data_class = 'SYNTHETIC' AND substr(source, 1, 10) = 'synthetic_'
            AND instr(upper(label), 'SYNTHETIC') > 0 AND instr(upper(label), 'HISTORICAL') = 0)
        OR (data_class = 'HISTORICAL' AND instr(lower(source), 'synthetic') = 0
            AND instr(upper(label), 'HISTORICAL') > 0 AND instr(upper(label), 'SYNTHETIC') = 0
            AND checksum_scheme = 'event_stream_v1' AND calendar_id IS NOT NULL))
) STRICT;

CREATE TRIGGER tr_datasets_seal BEFORE INSERT ON datasets
BEGIN
    SELECT RAISE(ABORT, 'dataset manifest does not describe this dataset')
    WHERE NOT EXISTS (SELECT 1 FROM dataset_manifests m
                       WHERE m.manifest_checksum = NEW.manifest_checksum AND m.dataset_id = NEW.dataset_id
                         AND m.dataset_version = NEW.dataset_version AND m.data_class = NEW.data_class);
    SELECT RAISE(ABORT, 'dataset event_count does not match its stored events')
    WHERE NEW.event_count <> (SELECT COUNT(*) FROM dataset_events
                               WHERE dataset_id = NEW.dataset_id AND dataset_version = NEW.dataset_version)
       OR NEW.event_count <> (SELECT MAX(position) FROM dataset_events
                               WHERE dataset_id = NEW.dataset_id AND dataset_version = NEW.dataset_version);
    SELECT RAISE(ABORT, 'first dataset event must be SESSION_OPEN at the session start')
    WHERE NOT EXISTS (SELECT 1 FROM dataset_events WHERE dataset_id = NEW.dataset_id
                         AND dataset_version = NEW.dataset_version AND position = 1
                         AND event_type = 'SESSION_OPEN' AND julianday(at) = julianday(NEW.session_start));
    SELECT RAISE(ABORT, 'last dataset event must be SESSION_CLOSE at the session end')
    WHERE NOT EXISTS (SELECT 1 FROM dataset_events WHERE dataset_id = NEW.dataset_id
                         AND dataset_version = NEW.dataset_version AND position = NEW.event_count
                         AND event_type = 'SESSION_CLOSE' AND julianday(at) = julianday(NEW.session_end));
END;
CREATE TRIGGER tr_datasets_no_update BEFORE UPDATE ON datasets
BEGIN SELECT RAISE(ABORT, 'stored datasets are immutable; publish a new dataset_version'); END;
CREATE TRIGGER tr_datasets_no_delete BEFORE DELETE ON datasets
BEGIN SELECT RAISE(ABORT, 'stored datasets are immutable'); END;
"""

# --- rebuilt tables -----------------------------------------------------------
# Column lists are identical to the Step 7 schema (0001-0003) apart from the
# changes listed in the module docstring.

RUNS = """
CREATE TABLE runs_new (
    run_id                    TEXT PRIMARY KEY CHECK (length(run_id) > 0),
    init_key                  TEXT NOT NULL UNIQUE CHECK (length(init_key) > 0),
    init_payload_hash         TEXT NOT NULL,
    schema_version            TEXT NOT NULL CHECK (schema_version = '1.0'),
    mode                      TEXT NOT NULL CHECK (mode IN ('SAMPLE_PAPER','HISTORICAL_PAPER')),
    is_sample                 INTEGER NOT NULL CHECK (is_sample IN (0, 1)),
    status                    TEXT NOT NULL
                              CHECK (status IN ('READY','RUNNING','PAUSED','COMPLETED','INCOMPLETE')),
    created_at                TEXT NOT NULL CHECK (created_at LIKE '____-__-__T__:__:__%Z'),
    currency                  TEXT NOT NULL CHECK (currency = 'USD'),
    starting_cash_cents       INTEGER NOT NULL CHECK (starting_cash_cents > 0),
    strategy_id               TEXT NOT NULL,
    strategy_version          TEXT NOT NULL,
    risk_policy_version       TEXT NOT NULL,
    execution_model_version   TEXT NOT NULL,
    fee_schedule_version      TEXT NOT NULL,
    fee_per_contract_cents    INTEGER NOT NULL CHECK (fee_per_contract_cents >= 0),
    entry_risk_limit_cents    INTEGER NOT NULL CHECK (entry_risk_limit_cents > 0),
    session_timezone          TEXT NOT NULL CHECK (session_timezone = 'America/New_York'),
    session_start             TEXT NOT NULL CHECK (session_start LIKE '____-__-__T__:__:__%Z'),
    session_end               TEXT NOT NULL CHECK (session_end LIKE '____-__-__T__:__:__%Z'),
    simulated_clock           TEXT NOT NULL CHECK (simulated_clock LIKE '____-__-__T__:__:__%Z'),
    session_reference_cents   INTEGER CHECK (session_reference_cents > 0),
    fixture_id                TEXT,
    fixture_version           TEXT,
    fixture_checksum          TEXT,
    checkpoint_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint_event_sequence >= 0),
    trading_enabled           INTEGER NOT NULL DEFAULT 0 CHECK (trading_enabled IN (0, 1)),
    status_reason             TEXT,
    CHECK (session_end > session_start),
    -- Fixture metadata may be absent only before the run starts (SPEC.md 11.2).
    CHECK (status = 'READY' OR (session_reference_cents IS NOT NULL AND fixture_id IS NOT NULL
                                AND fixture_version IS NOT NULL AND fixture_checksum IS NOT NULL)),
    -- Data class: synthetic sample data <-> SAMPLE_PAPER; historical data <-> HISTORICAL_PAPER.
    CHECK ((mode = 'SAMPLE_PAPER') = (is_sample = 1))
) STRICT
"""

MARKET_QUOTES = """
CREATE TABLE market_quotes_new (
    quote_id                TEXT PRIMARY KEY,
    schema_version          TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id                  TEXT NOT NULL REFERENCES runs(run_id),
    event_sequence          INTEGER NOT NULL CHECK (event_sequence >= 1),
    contract_id             TEXT NOT NULL REFERENCES option_contracts(contract_id),
    source                  TEXT NOT NULL,
    is_sample               INTEGER NOT NULL CHECK (is_sample IN (0, 1)),
    source_sequence         INTEGER NOT NULL CHECK (source_sequence >= 0),
    observed_at             TEXT NOT NULL,
    received_at             TEXT NOT NULL,
    bid_cents               INTEGER NOT NULL CHECK (bid_cents >= 0),
    ask_cents               INTEGER NOT NULL CHECK (ask_cents > 0),
    bid_size                INTEGER NOT NULL CHECK (bid_size >= 0),
    ask_size                INTEGER NOT NULL CHECK (ask_size >= 0),
    underlying_price_cents  INTEGER NOT NULL CHECK (underlying_price_cents > 0),
    underlying_observed_at  TEXT NOT NULL,
    session_reference_cents INTEGER CHECK (session_reference_cents > 0),
    CHECK (bid_cents <= ask_cents),
    UNIQUE (run_id, source, source_sequence)
) STRICT
"""

REPLAY_STATE = """
CREATE TABLE replay_state_new (
    run_id          TEXT PRIMARY KEY REFERENCES runs(run_id),
    fixture_id      TEXT NOT NULL,
    fixture_version TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('ACTIVE','PAUSED','EXHAUSTED')),
    next_position   INTEGER NOT NULL CHECK (next_position >= 1),
    total_events    INTEGER NOT NULL CHECK (total_events >= 1),
    loaded_at       TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (fixture_id, fixture_version) REFERENCES datasets(dataset_id, dataset_version),
    CHECK (next_position <= total_events + 1),
    CHECK ((status = 'EXHAUSTED') = (next_position = total_events + 1))
) STRICT
"""

NEW_TRIGGERS = """
-- Entry-rejection cooldown lookups read only the last minute of rejections (FA-1a).
CREATE INDEX ix_risk_decisions_run_decision_time ON risk_decisions(run_id, decision, evaluated_at);
CREATE INDEX ix_orders_run_status_time ON orders(run_id, status, updated_at);

CREATE TABLE quote_provenance (
    quote_id    TEXT PRIMARY KEY REFERENCES market_quotes(quote_id),
    snapshot_at TEXT CHECK (snapshot_at LIKE '____-__-__T__:__:__%Z'),
    ingested_at TEXT CHECK (ingested_at LIKE '____-__-__T__:__:__%Z'),
    CHECK (snapshot_at IS NOT NULL OR ingested_at IS NOT NULL)
) STRICT;

-- A snapshot or an ingestion record can never be older than the observation it holds.
CREATE TRIGGER tr_quote_provenance_times BEFORE INSERT ON quote_provenance
BEGIN
    SELECT RAISE(ABORT, 'snapshot_at and ingested_at must not precede the quote observed_at')
    WHERE julianday(NEW.snapshot_at) < julianday((SELECT observed_at FROM market_quotes WHERE quote_id = NEW.quote_id))
       OR julianday(NEW.ingested_at) < julianday((SELECT observed_at FROM market_quotes WHERE quote_id = NEW.quote_id));
END;
CREATE TRIGGER tr_quote_provenance_no_update BEFORE UPDATE ON quote_provenance
BEGIN SELECT RAISE(ABORT, 'quote provenance is immutable'); END;
CREATE TRIGGER tr_quote_provenance_no_delete BEFORE DELETE ON quote_provenance
BEGIN SELECT RAISE(ABORT, 'quote provenance is immutable'); END;

CREATE TRIGGER tr_runs_data_class_fixed BEFORE UPDATE OF is_sample ON runs
WHEN NEW.is_sample IS NOT OLD.is_sample
BEGIN SELECT RAISE(ABORT, 'a run''s data class is fixed when it is created'); END;

CREATE TRIGGER tr_quotes_data_class BEFORE INSERT ON market_quotes
BEGIN
    SELECT RAISE(ABORT, 'quote data class must match its run (synthetic vs historical)')
    WHERE NEW.is_sample IS NOT (SELECT is_sample FROM runs WHERE run_id = NEW.run_id);
END;

CREATE TRIGGER tr_replay_state_dataset_class BEFORE INSERT ON replay_state
BEGIN
    SELECT RAISE(ABORT, 'dataset data class does not match the run mode')
    WHERE (SELECT data_class FROM datasets WHERE dataset_id = NEW.fixture_id
              AND dataset_version = NEW.fixture_version)
       IS NOT (SELECT CASE mode WHEN 'SAMPLE_PAPER' THEN 'SYNTHETIC' WHEN 'HISTORICAL_PAPER' THEN 'HISTORICAL' END
                 FROM runs WHERE run_id = NEW.run_id);
    SELECT RAISE(ABORT, 'replay total_events must equal the dataset event_count')
    WHERE NEW.total_events IS NOT (SELECT event_count FROM datasets WHERE dataset_id = NEW.fixture_id
                                      AND dataset_version = NEW.fixture_version);
END;
"""


def _run(conn: sqlite3.Connection, script: str) -> None:
    """Execute statements one at a time (executescript would commit the transaction)."""
    buf = ""
    for line in script.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            if buf.strip():
                conn.execute(buf)
            buf = ""
    if buf.strip():
        raise sqlite3.OperationalError(f"incomplete statement: {buf.strip()[:80]}")


def _dependent_sql(conn: sqlite3.Connection, table: str) -> list[str]:
    """Original CREATE text of the table's own indexes and triggers (dropped with the table)."""
    rows = conn.execute(
        "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') "
        "AND sql IS NOT NULL ORDER BY type, name",
        (table,),
    ).fetchall()
    return [r[2] for r in rows]


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def _rebuild(conn: sqlite3.Connection, table: str, create_sql: str) -> None:
    dependents = _dependent_sql(conn, table)
    before = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    conn.execute(create_sql)
    old_cols = _columns(conn, table)
    new_cols = _columns(conn, f"{table}_new")
    missing = [c for c in old_cols if c not in new_cols]
    if missing:
        raise sqlite3.OperationalError(f"rebuild of {table} would drop columns {missing}")
    cols = ", ".join(old_cols)
    conn.execute(f"INSERT INTO {table}_new ({cols}) SELECT {cols} FROM {table}")
    after = conn.execute(f"SELECT COUNT(*) FROM {table}_new").fetchone()[0]
    if after != before:
        raise sqlite3.OperationalError(f"rebuild of {table} copied {after} of {before} rows")
    conn.execute(f"DROP TABLE {table}")
    conn.execute(f"ALTER TABLE {table}_new RENAME TO {table}")
    for sql in dependents:
        conn.execute(sql)


# --- legacy fixture backfill --------------------------------------------------


def _canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _event_line(position: int, event: dict) -> str:
    return _canonical({
        "position": position,
        "event_type": event["event_type"],
        "at": event["at"],
        "ref": event.get("ref"),
        "input": event.get("input"),
    }) + "\n"


def _backfill_fixtures(conn: sqlite3.Connection) -> int:
    rows = conn.execute(
        "SELECT * FROM fixtures ORDER BY stored_at, fixture_id, fixture_version").fetchall()
    for row in rows:
        (fixture_id, fixture_version, checksum, _schema, source, _is_sample, tz, start, end, reference,
         event_count, content_json, stored_at) = tuple(row)
        doc = json.loads(content_json)
        events = doc["events"]
        if len(events) != event_count:
            raise sqlite3.IntegrityError(f"fixture {fixture_id} {fixture_version} event count mismatch")
        digest = hashlib.sha256()
        for position, event in enumerate(events, start=1):
            digest.update(_event_line(position, event).encode("utf-8"))
            conn.execute(
                "INSERT INTO dataset_events (dataset_id, dataset_version, position, event_type, at, ref, input_json) "
                "VALUES (?,?,?,?,?,?,?)",
                (fixture_id, fixture_version, position, event["event_type"], event["at"], event.get("ref"),
                 None if event.get("input") is None else _canonical(event["input"])),
            )
        manifest = {
            "manifest_schema_version": "1.0",
            "dataset_id": fixture_id,
            "dataset_version": fixture_version,
            "data_class": "SYNTHETIC",
            "source": source,
            "label": doc["data_label"],
            "description": doc["description"],
            "generator": {"name": "hand_authored_fixture", "fixture_schema_version": doc["fixture_schema_version"]},
            "checksum_scheme": "fixture_document_v1",
            "document_checksum": checksum,
            "calendar_id": None,
        }
        manifest_json = _canonical(manifest)
        manifest_checksum = _sha(manifest_json)
        conn.execute(
            "INSERT OR IGNORE INTO dataset_manifests (manifest_checksum, dataset_id, dataset_version, data_class, "
            "manifest_json, stored_at) VALUES (?,?,?,?,?,?)",
            (manifest_checksum, fixture_id, fixture_version, "SYNTHETIC", manifest_json, stored_at),
        )
        conn.execute(
            "INSERT INTO datasets (dataset_id, dataset_version, checksum, checksum_scheme, events_digest, data_class, "
            "source, label, underlying, session_timezone, session_start, session_end, session_reference_cents, "
            "calendar_id, contracts_json, event_count, manifest_checksum, stored_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (fixture_id, fixture_version, checksum, "fixture_document_v1", "sha256:" + digest.hexdigest(),
             "SYNTHETIC", source, doc["data_label"], doc["underlying"], tz, start, end, reference, None,
             _canonical(doc["contracts"]), event_count, manifest_checksum, stored_at),
        )
    return len(rows)


def upgrade(conn: sqlite3.Connection) -> None:
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ("runs", "market_quotes", "replay_state", "fixtures")}
    _run(conn, NEW_TABLES)
    _rebuild(conn, "runs", RUNS)
    _rebuild(conn, "market_quotes", MARKET_QUOTES)
    stored = _backfill_fixtures(conn)
    _rebuild(conn, "replay_state", REPLAY_STATE)
    _run(conn, NEW_TRIGGERS)
    if stored != counts["fixtures"]:
        raise sqlite3.IntegrityError("not every stored fixture was converted to a dataset")
    for table in ("runs", "market_quotes", "replay_state"):
        if conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] != counts[table]:
            raise sqlite3.IntegrityError(f"{table} row count changed during migration")
    # Every existing replay binding must now resolve to a dataset with the same content.
    orphan = conn.execute(
        "SELECT COUNT(*) FROM replay_state s LEFT JOIN datasets d "
        "ON d.dataset_id = s.fixture_id AND d.dataset_version = s.fixture_version "
        "WHERE d.dataset_id IS NULL OR d.event_count <> s.total_events").fetchone()[0]
    mismatched_runs = conn.execute(
        "SELECT COUNT(*) FROM runs r LEFT JOIN datasets d "
        "ON d.dataset_id = r.fixture_id AND d.dataset_version = r.fixture_version "
        "WHERE r.fixture_checksum IS NOT NULL AND (d.checksum IS NULL OR d.checksum <> r.fixture_checksum)"
    ).fetchone()[0]
    if orphan or mismatched_runs:
        raise sqlite3.IntegrityError("existing runs do not match their converted datasets")
