-- 0001_initial: records defined in SPEC.md Section 5.
-- Money is INTEGER cents; timestamps are RFC 3339 UTC TEXT ending in 'Z'.
-- STRICT tables reject values of the wrong storage class (e.g. REAL cents).

CREATE TABLE runs (
    run_id                    TEXT PRIMARY KEY CHECK (length(run_id) > 0),
    init_key                  TEXT NOT NULL UNIQUE CHECK (length(init_key) > 0),
    init_payload_hash         TEXT NOT NULL,
    schema_version            TEXT NOT NULL CHECK (schema_version = '1.0'),
    mode                      TEXT NOT NULL CHECK (mode = 'SAMPLE_PAPER'),
    is_sample                 INTEGER NOT NULL CHECK (is_sample = 1),
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
    CHECK (session_end > session_start),
    -- Fixture metadata may be absent only before the run starts (SPEC.md 11.2).
    CHECK (status = 'READY' OR (session_reference_cents IS NOT NULL AND fixture_id IS NOT NULL
                                AND fixture_version IS NOT NULL AND fixture_checksum IS NOT NULL))
) STRICT;

CREATE TABLE accounts (
    account_id          TEXT PRIMARY KEY CHECK (length(account_id) > 0),
    run_id              TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
    schema_version      TEXT NOT NULL CHECK (schema_version = '1.0'),
    currency            TEXT NOT NULL CHECK (currency = 'USD'),
    starting_cash_cents INTEGER NOT NULL CHECK (starting_cash_cents > 0),
    account_revision    INTEGER NOT NULL CHECK (account_revision >= 1),
    created_at          TEXT NOT NULL
) STRICT;

CREATE TABLE watchlist_items (
    run_id   TEXT NOT NULL REFERENCES runs(run_id),
    symbol   TEXT NOT NULL CHECK (symbol = 'SPY'),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (run_id, symbol),
    UNIQUE (run_id, position)
) STRICT;

-- Deterministic per-run event ordering (SPEC.md clarification 4).
CREATE TABLE run_events (
    event_id       TEXT PRIMARY KEY,
    run_id         TEXT NOT NULL REFERENCES runs(run_id),
    event_sequence INTEGER NOT NULL CHECK (event_sequence >= 1),
    event_type     TEXT NOT NULL,
    simulated_at   TEXT NOT NULL,
    recorded_at    TEXT NOT NULL,
    payload_json   TEXT NOT NULL CHECK (json_valid(payload_json)),
    UNIQUE (run_id, event_sequence)
) STRICT;

-- Idempotent command results (same key + same payload -> original result).
CREATE TABLE command_log (
    idempotency_key TEXT PRIMARY KEY,
    run_id          TEXT REFERENCES runs(run_id),
    command_type    TEXT NOT NULL,
    payload_hash    TEXT NOT NULL,
    result_json     TEXT NOT NULL CHECK (json_valid(result_json)),
    recorded_at     TEXT NOT NULL
) STRICT;

-- A. Option contract
CREATE TABLE option_contracts (
    contract_id     TEXT PRIMARY KEY CHECK (length(contract_id) > 0),
    schema_version  TEXT NOT NULL CHECK (schema_version = '1.0'),
    underlying      TEXT NOT NULL,
    expiration_date TEXT NOT NULL CHECK (expiration_date LIKE '____-__-__' AND length(expiration_date) = 10),
    option_type     TEXT NOT NULL CHECK (option_type IN ('CALL','PUT')),
    strike_cents    INTEGER NOT NULL CHECK (strike_cents > 0),
    currency        TEXT NOT NULL CHECK (currency = 'USD'),
    multiplier      INTEGER NOT NULL CHECK (multiplier > 0),
    deliverable     TEXT NOT NULL,
    exercise_style  TEXT NOT NULL CHECK (exercise_style IN ('AMERICAN','EUROPEAN')),
    settlement_type TEXT NOT NULL CHECK (settlement_type IN ('PHYSICAL','CASH')),
    adjusted        INTEGER NOT NULL CHECK (adjusted IN (0,1)),
    UNIQUE (underlying, expiration_date, option_type, strike_cents, currency, deliverable)
) STRICT;

-- B. Market quote
CREATE TABLE market_quotes (
    quote_id                TEXT PRIMARY KEY,
    schema_version          TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id                  TEXT NOT NULL REFERENCES runs(run_id),
    event_sequence          INTEGER NOT NULL CHECK (event_sequence >= 1),
    contract_id             TEXT NOT NULL REFERENCES option_contracts(contract_id),
    source                  TEXT NOT NULL,
    is_sample               INTEGER NOT NULL CHECK (is_sample = 1),
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
) STRICT;

-- C. Trade proposal
CREATE TABLE trade_proposals (
    proposal_id       TEXT PRIMARY KEY,
    schema_version    TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id            TEXT NOT NULL REFERENCES runs(run_id),
    account_id        TEXT NOT NULL REFERENCES accounts(account_id),
    contract_id       TEXT NOT NULL REFERENCES option_contracts(contract_id),
    position_id       TEXT REFERENCES positions(position_id),
    quote_id          TEXT NOT NULL REFERENCES market_quotes(quote_id),
    strategy_id       TEXT NOT NULL,
    strategy_version  TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    intent            TEXT NOT NULL CHECK (intent IN ('BUY_TO_OPEN','SELL_TO_CLOSE')),
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    limit_cents       INTEGER NOT NULL CHECK (limit_cents > 0),
    reason_code       TEXT NOT NULL CHECK (reason_code IN ('ENTRY_SIGNAL','PROFIT_TARGET','LOSS_THRESHOLD',
                                                           'TIME_EXIT','MANUAL_CLOSE','EXIT_RETRY')),
    reason            TEXT NOT NULL CHECK (length(reason) > 0),
    profit_target_bps INTEGER NOT NULL CHECK (profit_target_bps > 0),
    loss_threshold_bps INTEGER NOT NULL CHECK (loss_threshold_bps > 0),
    max_hold_seconds  INTEGER NOT NULL CHECK (max_hold_seconds > 0),
    idempotency_key   TEXT NOT NULL UNIQUE,
    CHECK ((intent = 'BUY_TO_OPEN' AND position_id IS NULL AND reason_code = 'ENTRY_SIGNAL')
        OR (intent = 'SELL_TO_CLOSE' AND position_id IS NOT NULL AND reason_code <> 'ENTRY_SIGNAL'))
) STRICT;

-- D. Risk decision
CREATE TABLE risk_decisions (
    risk_decision_id       TEXT PRIMARY KEY,
    schema_version         TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id                 TEXT NOT NULL REFERENCES runs(run_id),
    proposal_id            TEXT NOT NULL UNIQUE REFERENCES trade_proposals(proposal_id),
    evaluated_at           TEXT NOT NULL,
    policy_version         TEXT NOT NULL,
    account_revision       INTEGER NOT NULL CHECK (account_revision >= 1),
    decision               TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
    reason_codes_json      TEXT NOT NULL CHECK (json_valid(reason_codes_json) AND json_type(reason_codes_json) = 'array'),
    required_cash_cents    INTEGER NOT NULL CHECK (required_cash_cents >= 0),
    available_cash_cents   INTEGER NOT NULL,
    entry_risk_cents       INTEGER NOT NULL CHECK (entry_risk_cents >= 0),
    entry_risk_limit_cents INTEGER NOT NULL CHECK (entry_risk_limit_cents >= 0),
    CHECK ((decision = 'REJECTED' AND json_array_length(reason_codes_json) > 0)
        OR (decision = 'APPROVED' AND json_array_length(reason_codes_json) = 0))
) STRICT;

-- E. Order
CREATE TABLE orders (
    order_id              TEXT PRIMARY KEY,
    schema_version        TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id                TEXT NOT NULL REFERENCES runs(run_id),
    account_id            TEXT NOT NULL REFERENCES accounts(account_id),
    proposal_id           TEXT NOT NULL UNIQUE REFERENCES trade_proposals(proposal_id),
    risk_decision_id      TEXT NOT NULL UNIQUE REFERENCES risk_decisions(risk_decision_id),
    contract_id           TEXT NOT NULL REFERENCES option_contracts(contract_id),
    position_id           TEXT REFERENCES positions(position_id),
    intent                TEXT NOT NULL CHECK (intent IN ('BUY_TO_OPEN','SELL_TO_CLOSE')),
    quantity              INTEGER NOT NULL CHECK (quantity > 0),
    limit_cents           INTEGER NOT NULL CHECK (limit_cents > 0),
    status                TEXT NOT NULL CHECK (status IN ('PENDING','OPEN','FILLED','REJECTED','CANCELED','EXPIRED')),
    submitted_at          TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    expires_at            TEXT NOT NULL,
    after_source_sequence INTEGER NOT NULL CHECK (after_source_sequence >= 0),
    reserved_cash_cents   INTEGER NOT NULL CHECK (reserved_cash_cents >= 0),
    reserved_contracts    INTEGER NOT NULL CHECK (reserved_contracts >= 0),
    idempotency_key       TEXT NOT NULL UNIQUE,
    terminal_reason       TEXT,
    CHECK (expires_at > submitted_at),
    CHECK ((intent = 'BUY_TO_OPEN' AND position_id IS NULL AND reserved_contracts = 0)
        OR (intent = 'SELL_TO_CLOSE' AND position_id IS NOT NULL AND reserved_cash_cents = 0)),
    CHECK (status IN ('PENDING','OPEN') OR (reserved_cash_cents = 0 AND reserved_contracts = 0)),
    CHECK ((status IN ('REJECTED','CANCELED','EXPIRED') AND terminal_reason IS NOT NULL)
        OR (status IN ('PENDING','OPEN') AND terminal_reason IS NULL)
        OR status = 'FILLED')
) STRICT;

-- F. Fill (immutable)
CREATE TABLE fills (
    fill_id                 TEXT PRIMARY KEY,
    schema_version          TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id                  TEXT NOT NULL REFERENCES runs(run_id),
    order_id                TEXT NOT NULL UNIQUE REFERENCES orders(order_id),
    quote_id                TEXT NOT NULL REFERENCES market_quotes(quote_id),
    filled_at               TEXT NOT NULL,
    quantity                INTEGER NOT NULL CHECK (quantity > 0),
    price_cents             INTEGER NOT NULL CHECK (price_cents > 0),
    multiplier              INTEGER NOT NULL CHECK (multiplier > 0),
    gross_cents             INTEGER NOT NULL CHECK (gross_cents >= 0),
    fee_cents               INTEGER NOT NULL CHECK (fee_cents >= 0),
    execution_model_version TEXT NOT NULL,
    fee_schedule_version    TEXT NOT NULL,
    CHECK (gross_cents = price_cents * multiplier * quantity)
) STRICT;

-- G. Position
CREATE TABLE positions (
    position_id                TEXT PRIMARY KEY,
    schema_version             TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id                     TEXT NOT NULL REFERENCES runs(run_id),
    account_id                 TEXT NOT NULL REFERENCES accounts(account_id),
    contract_id                TEXT NOT NULL REFERENCES option_contracts(contract_id),
    entry_fill_id              TEXT NOT NULL UNIQUE REFERENCES fills(fill_id),
    opened_at                  TEXT NOT NULL,
    closed_at                  TEXT,
    status                     TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED')),
    quantity                   INTEGER NOT NULL CHECK (quantity >= 0),
    reserved_contracts         INTEGER NOT NULL CHECK (reserved_contracts >= 0),
    entry_price_cents          INTEGER NOT NULL CHECK (entry_price_cents > 0),
    remaining_cost_basis_cents INTEGER NOT NULL CHECK (remaining_cost_basis_cents >= 0),
    mark_quote_id              TEXT REFERENCES market_quotes(quote_id),
    market_value_cents         INTEGER CHECK (market_value_cents >= 0),
    unrealized_pnl_cents       INTEGER,
    valuation_status           TEXT NOT NULL CHECK (valuation_status IN ('CURRENT','STALE','UNAVAILABLE')),
    CHECK (reserved_contracts <= quantity),
    CHECK ((status = 'OPEN' AND closed_at IS NULL AND quantity > 0)
        OR (status = 'CLOSED' AND closed_at IS NOT NULL AND quantity = 0 AND reserved_contracts = 0
            AND remaining_cost_basis_cents = 0 AND COALESCE(market_value_cents, 0) = 0
            AND COALESCE(unrealized_pnl_cents, 0) = 0))
) STRICT;

-- H. Account snapshot (derived; never a source of cash truth)
CREATE TABLE account_snapshots (
    snapshot_id          TEXT PRIMARY KEY,
    schema_version       TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id               TEXT NOT NULL REFERENCES runs(run_id),
    account_id           TEXT NOT NULL REFERENCES accounts(account_id),
    account_revision     INTEGER NOT NULL CHECK (account_revision >= 1),
    as_of                TEXT NOT NULL,
    currency             TEXT NOT NULL CHECK (currency = 'USD'),
    starting_cash_cents  INTEGER NOT NULL CHECK (starting_cash_cents > 0),
    cash_cents           INTEGER NOT NULL,
    reserved_cash_cents  INTEGER NOT NULL CHECK (reserved_cash_cents >= 0),
    available_cash_cents INTEGER NOT NULL,
    market_value_cents   INTEGER CHECK (market_value_cents >= 0),
    equity_cents         INTEGER,
    realized_pnl_cents   INTEGER NOT NULL,
    unrealized_pnl_cents INTEGER,
    fees_paid_cents      INTEGER NOT NULL CHECK (fees_paid_cents >= 0),
    valuation_status     TEXT NOT NULL CHECK (valuation_status IN ('CURRENT','STALE','UNAVAILABLE')),
    UNIQUE (account_id, account_revision),
    CHECK (available_cash_cents = cash_cents - reserved_cash_cents)
) STRICT;

-- I. Cash ledger entry (immutable)
CREATE TABLE cash_ledger_entries (
    ledger_entry_id          TEXT PRIMARY KEY,
    schema_version           TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id                   TEXT NOT NULL REFERENCES runs(run_id),
    account_id               TEXT NOT NULL REFERENCES accounts(account_id),
    ledger_sequence          INTEGER NOT NULL CHECK (ledger_sequence >= 1),
    recorded_at              TEXT NOT NULL,
    entry_type               TEXT NOT NULL CHECK (entry_type IN ('INITIAL_FUNDING','BUY_FILL','SELL_FILL')),
    fill_id                  TEXT UNIQUE REFERENCES fills(fill_id),
    premium_cash_delta_cents INTEGER NOT NULL,
    fee_cash_delta_cents     INTEGER NOT NULL CHECK (fee_cash_delta_cents <= 0),
    net_cash_delta_cents     INTEGER NOT NULL,
    balance_after_cents      INTEGER NOT NULL,
    CHECK (net_cash_delta_cents = premium_cash_delta_cents + fee_cash_delta_cents),
    CHECK ((entry_type = 'INITIAL_FUNDING' AND fill_id IS NULL AND fee_cash_delta_cents = 0
            AND premium_cash_delta_cents > 0)
        OR (entry_type = 'BUY_FILL' AND fill_id IS NOT NULL AND premium_cash_delta_cents < 0)
        OR (entry_type = 'SELL_FILL' AND fill_id IS NOT NULL AND premium_cash_delta_cents > 0)),
    UNIQUE (account_id, ledger_sequence)
) STRICT;

-- One funding entry per run.
CREATE UNIQUE INDEX ux_ledger_one_funding_per_run
    ON cash_ledger_entries(run_id) WHERE entry_type = 'INITIAL_FUNDING';

-- J. Closed-trade record (immutable)
CREATE TABLE closed_trades (
    closed_trade_id         TEXT PRIMARY KEY,
    schema_version          TEXT NOT NULL CHECK (schema_version = '1.0'),
    run_id                  TEXT NOT NULL REFERENCES runs(run_id),
    position_id             TEXT NOT NULL UNIQUE REFERENCES positions(position_id),
    entry_fill_id           TEXT NOT NULL UNIQUE REFERENCES fills(fill_id),
    exit_fill_id            TEXT NOT NULL UNIQUE REFERENCES fills(fill_id),
    strategy_id             TEXT NOT NULL,
    strategy_version        TEXT NOT NULL,
    opened_at               TEXT NOT NULL,
    closed_at               TEXT NOT NULL,
    quantity                INTEGER NOT NULL CHECK (quantity > 0),
    entry_cost_cents        INTEGER NOT NULL CHECK (entry_cost_cents > 0),
    exit_net_proceeds_cents INTEGER NOT NULL,
    total_fees_cents        INTEGER NOT NULL CHECK (total_fees_cents >= 0),
    realized_pnl_cents      INTEGER NOT NULL,
    exit_reason             TEXT NOT NULL CHECK (exit_reason IN ('PROFIT_TARGET','LOSS_THRESHOLD','TIME_EXIT',
                                                                 'MANUAL_CLOSE','EXIT_RETRY')),
    CHECK (realized_pnl_cents = exit_net_proceeds_cents - entry_cost_cents),
    CHECK (entry_fill_id <> exit_fill_id),
    CHECK (closed_at >= opened_at)
) STRICT;

CREATE INDEX ix_orders_run_status ON orders(run_id, status);
CREATE INDEX ix_positions_run_status ON positions(run_id, status);
CREATE INDEX ix_quotes_run_event ON market_quotes(run_id, event_sequence);

-- Immutable records: no UPDATE or DELETE.
CREATE TRIGGER tr_fills_no_update BEFORE UPDATE ON fills
BEGIN SELECT RAISE(ABORT, 'fills are immutable'); END;
CREATE TRIGGER tr_fills_no_delete BEFORE DELETE ON fills
BEGIN SELECT RAISE(ABORT, 'fills are immutable'); END;
CREATE TRIGGER tr_ledger_no_update BEFORE UPDATE ON cash_ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger entries are immutable'); END;
CREATE TRIGGER tr_ledger_no_delete BEFORE DELETE ON cash_ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger entries are immutable'); END;
CREATE TRIGGER tr_closed_trades_no_update BEFORE UPDATE ON closed_trades
BEGIN SELECT RAISE(ABORT, 'closed trades are immutable'); END;
CREATE TRIGGER tr_closed_trades_no_delete BEFORE DELETE ON closed_trades
BEGIN SELECT RAISE(ABORT, 'closed trades are immutable'); END;
CREATE TRIGGER tr_run_events_no_update BEFORE UPDATE ON run_events
BEGIN SELECT RAISE(ABORT, 'run events are immutable'); END;
CREATE TRIGGER tr_run_events_no_delete BEFORE DELETE ON run_events
BEGIN SELECT RAISE(ABORT, 'run events are immutable'); END;

-- Ledger sequences are contiguous per account and balances chain exactly.
CREATE TRIGGER tr_ledger_chain BEFORE INSERT ON cash_ledger_entries
BEGIN
    SELECT RAISE(ABORT, 'ledger_sequence must be contiguous')
    WHERE NEW.ledger_sequence <> 1 + COALESCE(
        (SELECT MAX(ledger_sequence) FROM cash_ledger_entries WHERE account_id = NEW.account_id), 0);
    SELECT RAISE(ABORT, 'balance_after_cents must equal previous balance plus net delta')
    WHERE NEW.balance_after_cents <> NEW.net_cash_delta_cents + COALESCE(
        (SELECT balance_after_cents FROM cash_ledger_entries
          WHERE account_id = NEW.account_id AND ledger_sequence = NEW.ledger_sequence - 1), 0);
    SELECT RAISE(ABORT, 'first ledger entry must be INITIAL_FUNDING')
    WHERE NEW.ledger_sequence = 1 AND NEW.entry_type <> 'INITIAL_FUNDING';
END;

-- Order lifecycle (SPEC.md Section 3): only permitted transitions; terminal states are final.
CREATE TRIGGER tr_orders_transition BEFORE UPDATE OF status ON orders
WHEN OLD.status <> NEW.status
BEGIN
    SELECT RAISE(ABORT, 'illegal order status transition')
    WHERE NOT ((OLD.status = 'PENDING' AND NEW.status IN ('OPEN','REJECTED'))
            OR (OLD.status = 'OPEN' AND NEW.status IN ('FILLED','CANCELED','EXPIRED')));
END;
CREATE TRIGGER tr_orders_terminal_frozen BEFORE UPDATE ON orders
WHEN OLD.status IN ('FILLED','REJECTED','CANCELED','EXPIRED')
BEGIN SELECT RAISE(ABORT, 'terminal orders cannot change'); END;
CREATE TRIGGER tr_orders_no_delete BEFORE DELETE ON orders
BEGIN SELECT RAISE(ABORT, 'orders cannot be deleted'); END;

-- Pinned run parameters never change after creation (SPEC.md Section 1).
CREATE TRIGGER tr_runs_pinned BEFORE UPDATE ON runs
WHEN NEW.starting_cash_cents IS NOT OLD.starting_cash_cents
  OR NEW.fee_per_contract_cents IS NOT OLD.fee_per_contract_cents
  OR NEW.fee_schedule_version IS NOT OLD.fee_schedule_version
  OR NEW.strategy_id IS NOT OLD.strategy_id
  OR NEW.strategy_version IS NOT OLD.strategy_version
  OR NEW.risk_policy_version IS NOT OLD.risk_policy_version
  OR NEW.execution_model_version IS NOT OLD.execution_model_version
  OR NEW.entry_risk_limit_cents IS NOT OLD.entry_risk_limit_cents
  OR NEW.currency IS NOT OLD.currency
  OR NEW.mode IS NOT OLD.mode
  OR NEW.init_key IS NOT OLD.init_key
  OR NEW.session_timezone IS NOT OLD.session_timezone
  OR NEW.session_start IS NOT OLD.session_start
  OR NEW.session_end IS NOT OLD.session_end
BEGIN SELECT RAISE(ABORT, 'pinned run parameters are immutable; create a new run'); END;
CREATE TRIGGER tr_runs_fixture_pinned BEFORE UPDATE ON runs
WHEN OLD.status <> 'READY'
 AND (NEW.fixture_id IS NOT OLD.fixture_id OR NEW.fixture_version IS NOT OLD.fixture_version
      OR NEW.fixture_checksum IS NOT OLD.fixture_checksum
      OR NEW.session_reference_cents IS NOT OLD.session_reference_cents)
BEGIN SELECT RAISE(ABORT, 'fixture metadata is pinned once a run starts'); END;
CREATE TRIGGER tr_runs_no_delete BEFORE DELETE ON runs
BEGIN SELECT RAISE(ABORT, 'runs cannot be deleted'); END;
CREATE TRIGGER tr_accounts_identity BEFORE UPDATE ON accounts
WHEN NEW.starting_cash_cents IS NOT OLD.starting_cash_cents OR NEW.run_id IS NOT OLD.run_id
  OR NEW.currency IS NOT OLD.currency OR NEW.account_id IS NOT OLD.account_id
BEGIN SELECT RAISE(ABORT, 'account identity and starting cash are immutable'); END;
CREATE TRIGGER tr_accounts_revision_forward BEFORE UPDATE OF account_revision ON accounts
WHEN NEW.account_revision <= OLD.account_revision
BEGIN SELECT RAISE(ABORT, 'account_revision must increase'); END;
