-- SQL dump of a database created by the Step 7 code (branch paper-trading-step7, 24befba).
-- Runs: legacy-replay (replay-only, exhausted), legacy-complete (trading, COMPLETED),
-- legacy-partial (trading, RUNNING, open position after 3 of 6 events). Used by test_upgrade_step7.py.
BEGIN TRANSACTION;
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
CREATE TABLE accounts (
    account_id          TEXT PRIMARY KEY CHECK (length(account_id) > 0),
    run_id              TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
    schema_version      TEXT NOT NULL CHECK (schema_version = '1.0'),
    currency            TEXT NOT NULL CHECK (currency = 'USD'),
    starting_cash_cents INTEGER NOT NULL CHECK (starting_cash_cents > 0),
    account_revision    INTEGER NOT NULL CHECK (account_revision >= 1),
    created_at          TEXT NOT NULL
) STRICT;
INSERT INTO "accounts" VALUES('acct_7b7734f42b0e4805880b25ba5899c14c','run_71e5010f65974922afaa711e364d914d','1.0','USD',10000000,1,'2026-09-29T17:42:22Z');
INSERT INTO "accounts" VALUES('acct_af6e4ec76da4417e909de93050aa0e5a','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','1.0','USD',10000000,5,'2026-09-29T17:42:22Z');
INSERT INTO "accounts" VALUES('acct_4af932fb4da84d5fb6154f0a0e37df3f','run_40fb6057391f4fc58bb23e17f65acea1','1.0','USD',10000000,3,'2026-09-29T17:42:22Z');
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
INSERT INTO "cash_ledger_entries" VALUES('led_0ab6b4869f574effb64bf7eb27348f80','1.0','run_71e5010f65974922afaa711e364d914d','acct_7b7734f42b0e4805880b25ba5899c14c',1,'2026-09-29T13:30:00Z','INITIAL_FUNDING',NULL,10000000,0,10000000,10000000);
INSERT INTO "cash_ledger_entries" VALUES('led_b0d16366c1014f0cb11c0a9c9605a023','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','acct_af6e4ec76da4417e909de93050aa0e5a',1,'2026-09-29T13:30:00Z','INITIAL_FUNDING',NULL,10000000,0,10000000,10000000);
INSERT INTO "cash_ledger_entries" VALUES('led_0a8338d2080a4e8e91c3afd3697046de','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','acct_af6e4ec76da4417e909de93050aa0e5a',2,'2026-09-29T14:00:01Z','BUY_FILL','fil_d0a7e705839c4b91a6e241edd45ddcd6',-40000,-65,-40065,9959935);
INSERT INTO "cash_ledger_entries" VALUES('led_e4393eacaf4b494d9040ad4634aa88a5','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','acct_af6e4ec76da4417e909de93050aa0e5a',3,'2026-09-29T14:10:01Z','SELL_FILL','fil_96670f37e4fc4b258078f5341c58bd76',48000,-65,47935,10007870);
INSERT INTO "cash_ledger_entries" VALUES('led_dc451ec8acc14349b4aada632ccac747','1.0','run_40fb6057391f4fc58bb23e17f65acea1','acct_4af932fb4da84d5fb6154f0a0e37df3f',1,'2026-09-29T13:30:00Z','INITIAL_FUNDING',NULL,10000000,0,10000000,10000000);
INSERT INTO "cash_ledger_entries" VALUES('led_c82e097f6de040d4ae5e29d898f30485','1.0','run_40fb6057391f4fc58bb23e17f65acea1','acct_4af932fb4da84d5fb6154f0a0e37df3f',2,'2026-09-29T14:00:01Z','BUY_FILL','fil_0222bbdf41384d33a8894bc74f3f88e6',-40000,-65,-40065,9959935);
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
INSERT INTO "closed_trades" VALUES('trd_cbeb7a44ca784984964f6afd72a8644b','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','pos_8b11ff20934e4cc9bd781b8e204a535b','fil_d0a7e705839c4b91a6e241edd45ddcd6','fil_96670f37e4fc4b258078f5341c58bd76','sample_spy_long_call','1.0.0','2026-09-29T14:00:01Z','2026-09-29T14:10:01Z',1,40065,47935,130,7870,'PROFIT_TARGET');
CREATE TABLE command_log (
    idempotency_key TEXT PRIMARY KEY,
    run_id          TEXT REFERENCES runs(run_id),
    command_type    TEXT NOT NULL,
    payload_hash    TEXT NOT NULL,
    result_json     TEXT NOT NULL CHECK (json_valid(result_json)),
    recorded_at     TEXT NOT NULL
) STRICT;
INSERT INTO "command_log" VALUES('init:legacy-replay','run_71e5010f65974922afaa711e364d914d','INIT_SAMPLE_RUN','dc300d3114472647339ea9fbceb072fb183f5073d5e29311b4f527af9196b027','{"account_id": "acct_7b7734f42b0e4805880b25ba5899c14c", "funding_ledger_entry_id": "led_0ab6b4869f574effb64bf7eb27348f80", "run_id": "run_71e5010f65974922afaa711e364d914d"}','2026-09-29T17:42:22Z');
INSERT INTO "command_log" VALUES('legacy-replay-all','run_71e5010f65974922afaa711e364d914d','REPLAY_RUN_TO_END','fa2f19646378f08471374390d27333f477ea3a504b5d55d6f6c2d20d9c50703f','{"next_position": 13, "replay_status": "EXHAUSTED", "steps_executed": 12, "stopped_because": "EXHAUSTED", "total_events": 12}','2026-09-29T17:42:22Z');
INSERT INTO "command_log" VALUES('init:legacy-complete','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','INIT_SAMPLE_RUN','fe607afab737d641a90e9a9b4dc78590adf7e29645d2bdb3d6343395a6f58cfd','{"account_id": "acct_af6e4ec76da4417e909de93050aa0e5a", "funding_ledger_entry_id": "led_b0d16366c1014f0cb11c0a9c9605a023", "run_id": "run_ec8ead49a3d2491fb4a91bb0d2dd1a7f"}','2026-09-29T17:42:22Z');
INSERT INTO "command_log" VALUES('legacy-complete-start','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','TRADING_START','00cf1c56ec5022b8ebac8150a7356384ee4e14c4223daa7f7fdcc7a14ae30585','{"run_status": "RUNNING"}','2026-09-29T17:42:22Z');
INSERT INTO "command_log" VALUES('legacy-complete-all','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','REPLAY_RUN_TO_END','149a42ca0d339f48823659f8b5474e595a75716acee68cc5991978982d98662f','{"next_position": 7, "replay_status": "EXHAUSTED", "steps_executed": 6, "stopped_because": "EXHAUSTED", "total_events": 6}','2026-09-29T17:42:22Z');
INSERT INTO "command_log" VALUES('init:legacy-partial','run_40fb6057391f4fc58bb23e17f65acea1','INIT_SAMPLE_RUN','fe607afab737d641a90e9a9b4dc78590adf7e29645d2bdb3d6343395a6f58cfd','{"account_id": "acct_4af932fb4da84d5fb6154f0a0e37df3f", "funding_ledger_entry_id": "led_dc451ec8acc14349b4aada632ccac747", "run_id": "run_40fb6057391f4fc58bb23e17f65acea1"}','2026-09-29T17:42:22Z');
INSERT INTO "command_log" VALUES('legacy-partial-start','run_40fb6057391f4fc58bb23e17f65acea1','TRADING_START','514ec36d06f1b2f4082b6ceff90c00cdfae7a4d17d74e53ac824c70a09e54451','{"run_status": "RUNNING"}','2026-09-29T17:42:22Z');
INSERT INTO "command_log" VALUES('legacy-partial-step-0','run_40fb6057391f4fc58bb23e17f65acea1','REPLAY_STEP','142c3396493dfbc57861e9451ac51fc4c2b98951e58df4035fa7e12d64ce93d1','{"event_type": "SESSION_OPEN", "fixture_ref": "open", "next_position": 2, "outcome": "BOUNDARY", "quote_id": null, "reason_codes": [], "rejection_id": null, "replay_position": 1, "replay_status": "ACTIVE", "scheduled_at": "2026-09-29T13:30:00Z", "simulated_clock": "2026-09-29T13:30:00Z", "total_events": 6}','2026-09-29T17:42:22Z');
INSERT INTO "command_log" VALUES('legacy-partial-step-1','run_40fb6057391f4fc58bb23e17f65acea1','REPLAY_STEP','142c3396493dfbc57861e9451ac51fc4c2b98951e58df4035fa7e12d64ce93d1','{"event_type": "QUOTE", "fixture_ref": "q1", "next_position": 3, "outcome": "ACCEPTED", "quote_id": "quo_82aceb8ecb5f49c59b1cba616d3d05a8", "reason_codes": [], "rejection_id": null, "replay_position": 2, "replay_status": "ACTIVE", "scheduled_at": "2026-09-29T14:00:00Z", "simulated_clock": "2026-09-29T14:00:00Z", "total_events": 6, "trading": {"fills": [], "routed": {"decision": "APPROVED", "order": {"order_id": "ord_1be66dddeaac4a5689596a7033e5be20", "status": "OPEN", "terminal_reason": null}, "proposal_id": "prp_d777e7508a9943c6b12c0b5854edd522"}}}','2026-09-29T17:42:22Z');
INSERT INTO "command_log" VALUES('legacy-partial-step-2','run_40fb6057391f4fc58bb23e17f65acea1','REPLAY_STEP','142c3396493dfbc57861e9451ac51fc4c2b98951e58df4035fa7e12d64ce93d1','{"event_type": "QUOTE", "fixture_ref": "q2", "next_position": 4, "outcome": "ACCEPTED", "quote_id": "quo_2b3938c5636842c8ad6f7e7532017452", "reason_codes": [], "rejection_id": null, "replay_position": 3, "replay_status": "ACTIVE", "scheduled_at": "2026-09-29T14:00:01Z", "simulated_clock": "2026-09-29T14:00:01Z", "total_events": 6, "trading": {"fills": ["fil_0222bbdf41384d33a8894bc74f3f88e6"], "routed": null}}','2026-09-29T17:42:22Z');
CREATE TABLE exit_intents (
    position_id           TEXT PRIMARY KEY REFERENCES positions(position_id),
    run_id                TEXT NOT NULL REFERENCES runs(run_id),
    reason_code           TEXT NOT NULL CHECK (reason_code IN ('PROFIT_TARGET','LOSS_THRESHOLD','TIME_EXIT',
                                                               'MANUAL_CLOSE')),
    requested_by          TEXT NOT NULL CHECK (requested_by IN ('STRATEGY','USER')),
    created_at            TEXT NOT NULL,
    trigger_quote_id      TEXT REFERENCES market_quotes(quote_id),
    resolved_at           TEXT,
    resolved_by_fill_id   TEXT UNIQUE REFERENCES fills(fill_id),
    CHECK ((resolved_at IS NULL) = (resolved_by_fill_id IS NULL)),
    CHECK ((requested_by = 'USER') = (reason_code = 'MANUAL_CLOSE'))
) STRICT;
INSERT INTO "exit_intents" VALUES('pos_8b11ff20934e4cc9bd781b8e204a535b','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','PROFIT_TARGET','STRATEGY','2026-09-29T14:10:00Z','quo_f79653c8e37f4578b8cafe63d1ea0d7f','2026-09-29T14:10:01Z','fil_96670f37e4fc4b258078f5341c58bd76');
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
INSERT INTO "fills" VALUES('fil_d0a7e705839c4b91a6e241edd45ddcd6','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','ord_becfde51f28f40e9a51bc9955e3bdede','quo_efc71bd7de024b93bd03fda9bd77125f','2026-09-29T14:00:01Z',1,400,100,40000,65,'next_quote_touch_v1','flat_65c_v1');
INSERT INTO "fills" VALUES('fil_96670f37e4fc4b258078f5341c58bd76','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','ord_265145d2cd2a4ed29894dcc5673eab53','quo_e23797bc62cb4dd4aa1fdb9bbc61aae3','2026-09-29T14:10:01Z',1,480,100,48000,65,'next_quote_touch_v1','flat_65c_v1');
INSERT INTO "fills" VALUES('fil_0222bbdf41384d33a8894bc74f3f88e6','1.0','run_40fb6057391f4fc58bb23e17f65acea1','ord_1be66dddeaac4a5689596a7033e5be20','quo_2b3938c5636842c8ad6f7e7532017452','2026-09-29T14:00:01Z',1,400,100,40000,65,'next_quote_touch_v1','flat_65c_v1');
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
INSERT INTO "fixtures" VALUES('test_invalid_inputs','1.0.0','sha256:024fa3bdbe67067858f893256955f3a75387dc22a8e916b1f337942a19c50a82','1.0','synthetic_fixture_v1',1,'America/New_York','2026-09-29T13:30:00Z','2026-09-29T20:00:00Z',59700,12,'{"checksum":"sha256:024fa3bdbe67067858f893256955f3a75387dc22a8e916b1f337942a19c50a82","contracts":[{"adjusted":false,"contract_id":"SPY_20261030_C_60000","currency":"USD","deliverable":"100_SPY_SHARES","exercise_style":"AMERICAN","expiration_date":"2026-10-30","multiplier":100,"option_type":"CALL","schema_version":"1.0","settlement_type":"PHYSICAL","strike_cents":60000,"underlying":"SPY"}],"data_label":"SYNTHETIC SAMPLE DATA - NOT REAL MARKET DATA - PAPER ONLY","description":"TEST FIXTURE: intentionally invalid quote inputs between valid ones. Not for normal use.","events":[{"at":"2026-09-29T13:30:00Z","event_type":"SESSION_OPEN","ref":"open"},{"at":"2026-09-29T14:00:00Z","event_type":"QUOTE","input":{"ask_cents":400,"ask_size":10,"bid_cents":390,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:00Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":1,"underlying_observed_at":"2026-09-29T14:00:00Z","underlying_price_cents":60000},"ref":"valid_1"},{"at":"2026-09-29T14:00:10Z","event_type":"QUOTE","input":{"ask_cents":121,"ask_size":10,"bid_cents":111,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:05Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":2,"underlying_observed_at":"2026-09-29T14:00:10Z","underlying_price_cents":60000},"ref":"stale"},{"at":"2026-09-29T14:00:11Z","event_type":"QUOTE","input":{"ask_cents":232,"ask_size":10,"bid_cents":222,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:15Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":3,"underlying_observed_at":"2026-09-29T14:00:11Z","underlying_price_cents":60000},"ref":"future"},{"at":"2026-09-29T14:00:12Z","event_type":"QUOTE","input":{"ask_cents":400,"ask_size":10,"bid_cents":410,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:12Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":4,"underlying_observed_at":"2026-09-29T14:00:12Z","underlying_price_cents":60000},"ref":"crossed"},{"at":"2026-09-29T14:00:13Z","event_type":"QUOTE","input":{"ask_cents":343,"ask_size":10,"bid_cents":333,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:13Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":1,"underlying_observed_at":"2026-09-29T14:00:13Z","underlying_price_cents":60000},"ref":"duplicate"},{"at":"2026-09-29T14:00:14Z","event_type":"QUOTE","input":{"ask_cents":405,"ask_size":10,"bid_cents":395,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:14Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":5,"underlying_observed_at":"2026-09-29T14:00:14Z","underlying_price_cents":60010},"ref":"valid_5"},{"at":"2026-09-29T14:00:15Z","event_type":"QUOTE","input":{"ask_cents":454,"ask_size":10,"bid_cents":444,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:15Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":4,"underlying_observed_at":"2026-09-29T14:00:15Z","underlying_price_cents":60000},"ref":"out_of_order"},{"at":"2026-09-29T14:00:16Z","event_type":"QUOTE","input":{"ask_cents":565,"bid_cents":555,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:16Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":6,"underlying_observed_at":"2026-09-29T14:00:16Z","underlying_price_cents":60000},"ref":"missing_size"},{"at":"2026-09-29T14:00:17Z","event_type":"QUOTE","input":{"ask_cents":676,"ask_size":10,"bid_cents":666,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:17Z","session_reference_cents":59800,"source":"synthetic_fixture_v1","source_sequence":7,"underlying_observed_at":"2026-09-29T14:00:17Z","underlying_price_cents":60000},"ref":"reference_mismatch"},{"at":"2026-09-29T14:00:18Z","event_type":"QUOTE","input":{"ask_cents":406,"ask_size":10,"bid_cents":396,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:18Z","source":"synthetic_fixture_v1","source_sequence":8,"underlying_observed_at":"2026-09-29T14:00:18Z","underlying_price_cents":60020},"ref":"valid_8_no_reference"},{"at":"2026-09-29T20:00:00Z","event_type":"SESSION_CLOSE","ref":"close"}],"fixture_id":"test_invalid_inputs","fixture_schema_version":"1.0","fixture_version":"1.0.0","is_sample":true,"session":{"end":"2026-09-29T20:00:00Z","start":"2026-09-29T13:30:00Z","timezone":"America/New_York"},"session_reference_cents":59700,"source":"synthetic_fixture_v1","underlying":"SPY"}','2026-09-29T17:42:22Z');
INSERT INTO "fixtures" VALUES('sample_spy_worked_trade','1.0.0','sha256:c1ddc15c1ec857be9242761055e4cd6bbe70612ee47b8dd03faebf5ed680ce1c','1.0','synthetic_fixture_v1',1,'America/New_York','2026-09-29T13:30:00Z','2026-09-29T20:00:00Z',59700,6,'{"checksum":"sha256:c1ddc15c1ec857be9242761055e4cd6bbe70612ee47b8dd03faebf5ed680ce1c","contracts":[{"adjusted":false,"contract_id":"SPY_20261030_C_60000","currency":"USD","deliverable":"100_SPY_SHARES","exercise_style":"AMERICAN","expiration_date":"2026-10-30","multiplier":100,"option_type":"CALL","schema_version":"1.0","settlement_type":"PHYSICAL","strike_cents":60000,"underlying":"SPY"}],"data_label":"SYNTHETIC SAMPLE DATA - NOT REAL MARKET DATA - PAPER ONLY","description":"SPEC.md Section 7 worked example: SPY Oct 30 2026 $600 call, quotes q1-q4. Synthetic prices.","events":[{"at":"2026-09-29T13:30:00Z","event_type":"SESSION_OPEN","ref":"open"},{"at":"2026-09-29T14:00:00Z","event_type":"QUOTE","input":{"ask_cents":400,"ask_size":10,"bid_cents":390,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:00Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":1,"underlying_observed_at":"2026-09-29T14:00:00Z","underlying_price_cents":60000},"ref":"q1"},{"at":"2026-09-29T14:00:01Z","event_type":"QUOTE","input":{"ask_cents":400,"ask_size":10,"bid_cents":390,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:01Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":2,"underlying_observed_at":"2026-09-29T14:00:01Z","underlying_price_cents":60000},"ref":"q2"},{"at":"2026-09-29T14:10:00Z","event_type":"QUOTE","input":{"ask_cents":490,"ask_size":10,"bid_cents":480,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:10:00Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":3,"underlying_observed_at":"2026-09-29T14:10:00Z","underlying_price_cents":60150},"ref":"q3"},{"at":"2026-09-29T14:10:01Z","event_type":"QUOTE","input":{"ask_cents":490,"ask_size":10,"bid_cents":480,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:10:01Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":4,"underlying_observed_at":"2026-09-29T14:10:01Z","underlying_price_cents":60150},"ref":"q4"},{"at":"2026-09-29T20:00:00Z","event_type":"SESSION_CLOSE","ref":"close"}],"fixture_id":"sample_spy_worked_trade","fixture_schema_version":"1.0","fixture_version":"1.0.0","is_sample":true,"session":{"end":"2026-09-29T20:00:00Z","start":"2026-09-29T13:30:00Z","timezone":"America/New_York"},"session_reference_cents":59700,"source":"synthetic_fixture_v1","underlying":"SPY"}','2026-09-29T17:42:22Z');
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
INSERT INTO "market_quotes" VALUES('quo_a22b1a4d48794dec8fbe221902919605','1.0','run_71e5010f65974922afaa711e364d914d',6,'SPY_20261030_C_60000','synthetic_fixture_v1',1,1,'2026-09-29T14:00:00Z','2026-09-29T14:00:00Z',390,400,10,10,60000,'2026-09-29T14:00:00Z',59700);
INSERT INTO "market_quotes" VALUES('quo_917cec88a7a445d6bd4b9501c3509d0a','1.0','run_71e5010f65974922afaa711e364d914d',11,'SPY_20261030_C_60000','synthetic_fixture_v1',1,5,'2026-09-29T14:00:14Z','2026-09-29T14:00:14Z',395,405,10,10,60010,'2026-09-29T14:00:14Z',59700);
INSERT INTO "market_quotes" VALUES('quo_dc114eaf6cfc42ebbe828561e11a8b8e','1.0','run_71e5010f65974922afaa711e364d914d',15,'SPY_20261030_C_60000','synthetic_fixture_v1',1,8,'2026-09-29T14:00:18Z','2026-09-29T14:00:18Z',396,406,10,10,60020,'2026-09-29T14:00:18Z',NULL);
INSERT INTO "market_quotes" VALUES('quo_388e178d68be42caa383eaf700ec0251','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',7,'SPY_20261030_C_60000','synthetic_fixture_v1',1,1,'2026-09-29T14:00:00Z','2026-09-29T14:00:00Z',390,400,10,10,60000,'2026-09-29T14:00:00Z',59700);
INSERT INTO "market_quotes" VALUES('quo_efc71bd7de024b93bd03fda9bd77125f','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',11,'SPY_20261030_C_60000','synthetic_fixture_v1',1,2,'2026-09-29T14:00:01Z','2026-09-29T14:00:01Z',390,400,10,10,60000,'2026-09-29T14:00:01Z',59700);
INSERT INTO "market_quotes" VALUES('quo_f79653c8e37f4578b8cafe63d1ea0d7f','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',13,'SPY_20261030_C_60000','synthetic_fixture_v1',1,3,'2026-09-29T14:10:00Z','2026-09-29T14:10:00Z',480,490,10,10,60150,'2026-09-29T14:10:00Z',59700);
INSERT INTO "market_quotes" VALUES('quo_e23797bc62cb4dd4aa1fdb9bbc61aae3','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',18,'SPY_20261030_C_60000','synthetic_fixture_v1',1,4,'2026-09-29T14:10:01Z','2026-09-29T14:10:01Z',480,490,10,10,60150,'2026-09-29T14:10:01Z',59700);
INSERT INTO "market_quotes" VALUES('quo_82aceb8ecb5f49c59b1cba616d3d05a8','1.0','run_40fb6057391f4fc58bb23e17f65acea1',7,'SPY_20261030_C_60000','synthetic_fixture_v1',1,1,'2026-09-29T14:00:00Z','2026-09-29T14:00:00Z',390,400,10,10,60000,'2026-09-29T14:00:00Z',59700);
INSERT INTO "market_quotes" VALUES('quo_2b3938c5636842c8ad6f7e7532017452','1.0','run_40fb6057391f4fc58bb23e17f65acea1',11,'SPY_20261030_C_60000','synthetic_fixture_v1',1,2,'2026-09-29T14:00:01Z','2026-09-29T14:00:01Z',390,400,10,10,60000,'2026-09-29T14:00:01Z',59700);
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
INSERT INTO "option_contracts" VALUES('SPY_20261030_C_60000','1.0','SPY','2026-10-30','CALL',60000,'USD',100,'100_SPY_SHARES','AMERICAN','PHYSICAL',0);
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
INSERT INTO "orders" VALUES('ord_becfde51f28f40e9a51bc9955e3bdede','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','acct_af6e4ec76da4417e909de93050aa0e5a','prp_16defabdf5e74e06871c579789ca9e94','rsk_c02c9af6e683422ea878f72f66cbb373','SPY_20261030_C_60000',NULL,'BUY_TO_OPEN',1,400,'FILLED','2026-09-29T14:00:00Z','2026-09-29T14:00:01Z','2026-09-29T14:01:00Z',1,0,0,'run_ec8ead49a3d2491fb4a91bb0d2dd1a7f:order:prp_16defabdf5e74e06871c579789ca9e94',NULL);
INSERT INTO "orders" VALUES('ord_265145d2cd2a4ed29894dcc5673eab53','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','acct_af6e4ec76da4417e909de93050aa0e5a','prp_5f5a750d925d4f3697ab81964f793dce','rsk_cef88a243f5f45be87e9cb6e685ddcf1','SPY_20261030_C_60000','pos_8b11ff20934e4cc9bd781b8e204a535b','SELL_TO_CLOSE',1,480,'FILLED','2026-09-29T14:10:00Z','2026-09-29T14:10:01Z','2026-09-29T14:11:00Z',3,0,0,'run_ec8ead49a3d2491fb4a91bb0d2dd1a7f:order:prp_5f5a750d925d4f3697ab81964f793dce',NULL);
INSERT INTO "orders" VALUES('ord_1be66dddeaac4a5689596a7033e5be20','1.0','run_40fb6057391f4fc58bb23e17f65acea1','acct_4af932fb4da84d5fb6154f0a0e37df3f','prp_d777e7508a9943c6b12c0b5854edd522','rsk_761d5b6c85c24c67852121e8f39b1c96','SPY_20261030_C_60000',NULL,'BUY_TO_OPEN',1,400,'FILLED','2026-09-29T14:00:00Z','2026-09-29T14:00:01Z','2026-09-29T14:01:00Z',1,0,0,'run_40fb6057391f4fc58bb23e17f65acea1:order:prp_d777e7508a9943c6b12c0b5854edd522',NULL);
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
INSERT INTO "positions" VALUES('pos_8b11ff20934e4cc9bd781b8e204a535b','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','acct_af6e4ec76da4417e909de93050aa0e5a','SPY_20261030_C_60000','fil_d0a7e705839c4b91a6e241edd45ddcd6','2026-09-29T14:00:01Z','2026-09-29T14:10:01Z','CLOSED',0,0,400,0,'quo_e23797bc62cb4dd4aa1fdb9bbc61aae3',0,0,'CURRENT');
INSERT INTO "positions" VALUES('pos_4a599e7c43a8451a87cd624a06dc940a','1.0','run_40fb6057391f4fc58bb23e17f65acea1','acct_4af932fb4da84d5fb6154f0a0e37df3f','SPY_20261030_C_60000','fil_0222bbdf41384d33a8894bc74f3f88e6','2026-09-29T14:00:01Z',NULL,'OPEN',1,0,400,40065,'quo_2b3938c5636842c8ad6f7e7532017452',39000,-1065,'CURRENT');
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
INSERT INTO "rejected_inputs" VALUES('rej_1b6bdaf85c3f4a7686b3dbb34f830770','run_71e5010f65974922afaa711e364d914d',7,3,'2026-09-29T14:00:10Z','synthetic_fixture_v1',2,'SPY_20261030_C_60000','{"ask_cents":121,"ask_size":10,"bid_cents":111,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:05Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":2,"underlying_observed_at":"2026-09-29T14:00:10Z","underlying_price_cents":60000}','["STALE_QUOTE"]');
INSERT INTO "rejected_inputs" VALUES('rej_2815c7a84fa046c6a0009d64d4229f07','run_71e5010f65974922afaa711e364d914d',8,4,'2026-09-29T14:00:11Z','synthetic_fixture_v1',3,'SPY_20261030_C_60000','{"ask_cents":232,"ask_size":10,"bid_cents":222,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:15Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":3,"underlying_observed_at":"2026-09-29T14:00:11Z","underlying_price_cents":60000}','["FUTURE_OBSERVATION"]');
INSERT INTO "rejected_inputs" VALUES('rej_3a6454daab244651b29505189e20bc1e','run_71e5010f65974922afaa711e364d914d',9,5,'2026-09-29T14:00:12Z','synthetic_fixture_v1',4,'SPY_20261030_C_60000','{"ask_cents":400,"ask_size":10,"bid_cents":410,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:12Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":4,"underlying_observed_at":"2026-09-29T14:00:12Z","underlying_price_cents":60000}','["CROSSED_QUOTE"]');
INSERT INTO "rejected_inputs" VALUES('rej_b84fbca167ab4e7cbdc8ef14ab0fa5f2','run_71e5010f65974922afaa711e364d914d',10,6,'2026-09-29T14:00:13Z','synthetic_fixture_v1',1,'SPY_20261030_C_60000','{"ask_cents":343,"ask_size":10,"bid_cents":333,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:13Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":1,"underlying_observed_at":"2026-09-29T14:00:13Z","underlying_price_cents":60000}','["DUPLICATE_SEQUENCE"]');
INSERT INTO "rejected_inputs" VALUES('rej_cd25324fde404b6bbbe73cbd5957cd33','run_71e5010f65974922afaa711e364d914d',12,8,'2026-09-29T14:00:15Z','synthetic_fixture_v1',4,'SPY_20261030_C_60000','{"ask_cents":454,"ask_size":10,"bid_cents":444,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:15Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":4,"underlying_observed_at":"2026-09-29T14:00:15Z","underlying_price_cents":60000}','["OUT_OF_ORDER_SEQUENCE"]');
INSERT INTO "rejected_inputs" VALUES('rej_52ce39d3c1be41e68983dee6999e1c50','run_71e5010f65974922afaa711e364d914d',13,9,'2026-09-29T14:00:16Z','synthetic_fixture_v1',6,'SPY_20261030_C_60000','{"ask_cents":565,"bid_cents":555,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:16Z","session_reference_cents":59700,"source":"synthetic_fixture_v1","source_sequence":6,"underlying_observed_at":"2026-09-29T14:00:16Z","underlying_price_cents":60000}','["MISSING_SIZE"]');
INSERT INTO "rejected_inputs" VALUES('rej_5f155d2e2c1e4bea9eeef20869a7c5dd','run_71e5010f65974922afaa711e364d914d',14,10,'2026-09-29T14:00:17Z','synthetic_fixture_v1',7,'SPY_20261030_C_60000','{"ask_cents":676,"ask_size":10,"bid_cents":666,"bid_size":10,"contract_id":"SPY_20261030_C_60000","is_sample":true,"observed_at":"2026-09-29T14:00:17Z","session_reference_cents":59800,"source":"synthetic_fixture_v1","source_sequence":7,"underlying_observed_at":"2026-09-29T14:00:17Z","underlying_price_cents":60000}','["REFERENCE_PRICE_MISMATCH"]');
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
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',1,5,'SESSION_OPEN','open','2026-09-29T13:30:00Z','BOUNDARY',NULL,NULL);
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',2,6,'QUOTE','valid_1','2026-09-29T14:00:00Z','ACCEPTED','quo_a22b1a4d48794dec8fbe221902919605',NULL);
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',3,7,'QUOTE','stale','2026-09-29T14:00:10Z','REJECTED',NULL,'rej_1b6bdaf85c3f4a7686b3dbb34f830770');
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',4,8,'QUOTE','future','2026-09-29T14:00:11Z','REJECTED',NULL,'rej_2815c7a84fa046c6a0009d64d4229f07');
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',5,9,'QUOTE','crossed','2026-09-29T14:00:12Z','REJECTED',NULL,'rej_3a6454daab244651b29505189e20bc1e');
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',6,10,'QUOTE','duplicate','2026-09-29T14:00:13Z','REJECTED',NULL,'rej_b84fbca167ab4e7cbdc8ef14ab0fa5f2');
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',7,11,'QUOTE','valid_5','2026-09-29T14:00:14Z','ACCEPTED','quo_917cec88a7a445d6bd4b9501c3509d0a',NULL);
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',8,12,'QUOTE','out_of_order','2026-09-29T14:00:15Z','REJECTED',NULL,'rej_cd25324fde404b6bbbe73cbd5957cd33');
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',9,13,'QUOTE','missing_size','2026-09-29T14:00:16Z','REJECTED',NULL,'rej_52ce39d3c1be41e68983dee6999e1c50');
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',10,14,'QUOTE','reference_mismatch','2026-09-29T14:00:17Z','REJECTED',NULL,'rej_5f155d2e2c1e4bea9eeef20869a7c5dd');
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',11,15,'QUOTE','valid_8_no_reference','2026-09-29T14:00:18Z','ACCEPTED','quo_dc114eaf6cfc42ebbe828561e11a8b8e',NULL);
INSERT INTO "replay_events" VALUES('run_71e5010f65974922afaa711e364d914d',12,16,'SESSION_CLOSE','close','2026-09-29T20:00:00Z','BOUNDARY',NULL,NULL);
INSERT INTO "replay_events" VALUES('run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',1,6,'SESSION_OPEN','open','2026-09-29T13:30:00Z','BOUNDARY',NULL,NULL);
INSERT INTO "replay_events" VALUES('run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',2,7,'QUOTE','q1','2026-09-29T14:00:00Z','ACCEPTED','quo_388e178d68be42caa383eaf700ec0251',NULL);
INSERT INTO "replay_events" VALUES('run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',3,11,'QUOTE','q2','2026-09-29T14:00:01Z','ACCEPTED','quo_efc71bd7de024b93bd03fda9bd77125f',NULL);
INSERT INTO "replay_events" VALUES('run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',4,13,'QUOTE','q3','2026-09-29T14:10:00Z','ACCEPTED','quo_f79653c8e37f4578b8cafe63d1ea0d7f',NULL);
INSERT INTO "replay_events" VALUES('run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',5,18,'QUOTE','q4','2026-09-29T14:10:01Z','ACCEPTED','quo_e23797bc62cb4dd4aa1fdb9bbc61aae3',NULL);
INSERT INTO "replay_events" VALUES('run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',6,20,'SESSION_CLOSE','close','2026-09-29T20:00:00Z','BOUNDARY',NULL,NULL);
INSERT INTO "replay_events" VALUES('run_40fb6057391f4fc58bb23e17f65acea1',1,6,'SESSION_OPEN','open','2026-09-29T13:30:00Z','BOUNDARY',NULL,NULL);
INSERT INTO "replay_events" VALUES('run_40fb6057391f4fc58bb23e17f65acea1',2,7,'QUOTE','q1','2026-09-29T14:00:00Z','ACCEPTED','quo_82aceb8ecb5f49c59b1cba616d3d05a8',NULL);
INSERT INTO "replay_events" VALUES('run_40fb6057391f4fc58bb23e17f65acea1',3,11,'QUOTE','q2','2026-09-29T14:00:01Z','ACCEPTED','quo_2b3938c5636842c8ad6f7e7532017452',NULL);
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
INSERT INTO "replay_state" VALUES('run_71e5010f65974922afaa711e364d914d','test_invalid_inputs','1.0.0','EXHAUSTED',13,12,'2026-09-29T17:42:22Z','2026-09-29T17:42:22Z');
INSERT INTO "replay_state" VALUES('run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','sample_spy_worked_trade','1.0.0','EXHAUSTED',7,6,'2026-09-29T17:42:22Z','2026-09-29T17:42:22Z');
INSERT INTO "replay_state" VALUES('run_40fb6057391f4fc58bb23e17f65acea1','sample_spy_worked_trade','1.0.0','ACTIVE',4,6,'2026-09-29T17:42:22Z','2026-09-29T17:42:22Z');
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
INSERT INTO "risk_decisions" VALUES('rsk_c02c9af6e683422ea878f72f66cbb373','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','prp_16defabdf5e74e06871c579789ca9e94','2026-09-29T14:00:00Z','risk_v1',1,'APPROVED','[]',40065,10000000,40065,100000);
INSERT INTO "risk_decisions" VALUES('rsk_cef88a243f5f45be87e9cb6e685ddcf1','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','prp_5f5a750d925d4f3697ab81964f793dce','2026-09-29T14:10:00Z','risk_v1',3,'APPROVED','[]',0,9959935,0,100000);
INSERT INTO "risk_decisions" VALUES('rsk_761d5b6c85c24c67852121e8f39b1c96','1.0','run_40fb6057391f4fc58bb23e17f65acea1','prp_d777e7508a9943c6b12c0b5854edd522','2026-09-29T14:00:00Z','risk_v1',1,'APPROVED','[]',40065,10000000,40065,100000);
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
INSERT INTO "run_events" VALUES('evt_ee79018f76d74854bd7e03c4982388ad','run_71e5010f65974922afaa711e364d914d',1,'RUN_CREATED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"init_key": "legacy-replay", "payload_hash": "dc300d3114472647339ea9fbceb072fb183f5073d5e29311b4f527af9196b027", "trading_enabled": false}');
INSERT INTO "run_events" VALUES('evt_912bc0d0b43942a48bb8294c63e9d90e','run_71e5010f65974922afaa711e364d914d',2,'WATCHLIST_SET','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"symbols": ["SPY"]}');
INSERT INTO "run_events" VALUES('evt_6d8168102ff540feb353d8cf69474694','run_71e5010f65974922afaa711e364d914d',3,'ACCOUNT_FUNDED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"account_id": "acct_7b7734f42b0e4805880b25ba5899c14c", "amount_cents": 10000000}');
INSERT INTO "run_events" VALUES('evt_5d5b1fc70bb6425cb883346f6e3f08f1','run_71e5010f65974922afaa711e364d914d',4,'FIXTURE_LOADED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"checksum": "sha256:024fa3bdbe67067858f893256955f3a75387dc22a8e916b1f337942a19c50a82", "fixture_id": "test_invalid_inputs", "fixture_version": "1.0.0", "session_reference_cents": 59700, "total_events": 12}');
INSERT INTO "run_events" VALUES('evt_3661b986563c4e1d81f5a2c4516f208e','run_71e5010f65974922afaa711e364d914d',5,'SESSION_OPEN','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"replay_position": 1}');
INSERT INTO "run_events" VALUES('evt_fead4a06afb843e4b3e909344bdb42de','run_71e5010f65974922afaa711e364d914d',6,'QUOTE_ACCEPTED','2026-09-29T14:00:00Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "quote_id": "quo_a22b1a4d48794dec8fbe221902919605", "replay_position": 2, "source_sequence": 1}');
INSERT INTO "run_events" VALUES('evt_7e1339bfe83c4ad2afa346c7c1f32bf7','run_71e5010f65974922afaa711e364d914d',7,'INPUT_REJECTED','2026-09-29T14:00:10Z','2026-09-29T17:42:22Z','{"reason_codes": ["STALE_QUOTE"], "rejection_id": "rej_1b6bdaf85c3f4a7686b3dbb34f830770", "replay_position": 3}');
INSERT INTO "run_events" VALUES('evt_b2db0b78d0714f5490ba29dc8d1bb664','run_71e5010f65974922afaa711e364d914d',8,'INPUT_REJECTED','2026-09-29T14:00:11Z','2026-09-29T17:42:22Z','{"reason_codes": ["FUTURE_OBSERVATION"], "rejection_id": "rej_2815c7a84fa046c6a0009d64d4229f07", "replay_position": 4}');
INSERT INTO "run_events" VALUES('evt_286f0e5028884dd58c2a0be06755a8aa','run_71e5010f65974922afaa711e364d914d',9,'INPUT_REJECTED','2026-09-29T14:00:12Z','2026-09-29T17:42:22Z','{"reason_codes": ["CROSSED_QUOTE"], "rejection_id": "rej_3a6454daab244651b29505189e20bc1e", "replay_position": 5}');
INSERT INTO "run_events" VALUES('evt_3991fe5947c84804ba6d4dc43a74c092','run_71e5010f65974922afaa711e364d914d',10,'INPUT_REJECTED','2026-09-29T14:00:13Z','2026-09-29T17:42:22Z','{"reason_codes": ["DUPLICATE_SEQUENCE"], "rejection_id": "rej_b84fbca167ab4e7cbdc8ef14ab0fa5f2", "replay_position": 6}');
INSERT INTO "run_events" VALUES('evt_fdd4ac97f8054df88b7440bfd9ceae79','run_71e5010f65974922afaa711e364d914d',11,'QUOTE_ACCEPTED','2026-09-29T14:00:14Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "quote_id": "quo_917cec88a7a445d6bd4b9501c3509d0a", "replay_position": 7, "source_sequence": 5}');
INSERT INTO "run_events" VALUES('evt_2c383c1973d346d291b93aa651d9eece','run_71e5010f65974922afaa711e364d914d',12,'INPUT_REJECTED','2026-09-29T14:00:15Z','2026-09-29T17:42:22Z','{"reason_codes": ["OUT_OF_ORDER_SEQUENCE"], "rejection_id": "rej_cd25324fde404b6bbbe73cbd5957cd33", "replay_position": 8}');
INSERT INTO "run_events" VALUES('evt_15650fa5cebf47539686177b32504616','run_71e5010f65974922afaa711e364d914d',13,'INPUT_REJECTED','2026-09-29T14:00:16Z','2026-09-29T17:42:22Z','{"reason_codes": ["MISSING_SIZE"], "rejection_id": "rej_52ce39d3c1be41e68983dee6999e1c50", "replay_position": 9}');
INSERT INTO "run_events" VALUES('evt_ee267565959044a6849d15f0310f43ec','run_71e5010f65974922afaa711e364d914d',14,'INPUT_REJECTED','2026-09-29T14:00:17Z','2026-09-29T17:42:22Z','{"reason_codes": ["REFERENCE_PRICE_MISMATCH"], "rejection_id": "rej_5f155d2e2c1e4bea9eeef20869a7c5dd", "replay_position": 10}');
INSERT INTO "run_events" VALUES('evt_16641f1befeb44adb2de4b36adb7479e','run_71e5010f65974922afaa711e364d914d',15,'QUOTE_ACCEPTED','2026-09-29T14:00:18Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "quote_id": "quo_dc114eaf6cfc42ebbe828561e11a8b8e", "replay_position": 11, "source_sequence": 8}');
INSERT INTO "run_events" VALUES('evt_0515571efeb14baaaa2085645b82e0cd','run_71e5010f65974922afaa711e364d914d',16,'SESSION_CLOSE','2026-09-29T20:00:00Z','2026-09-29T17:42:22Z','{"replay_position": 12}');
INSERT INTO "run_events" VALUES('evt_f62ea1a3bb94403091753d6891de8e4d','run_71e5010f65974922afaa711e364d914d',17,'REPLAY_EXHAUSTED','2026-09-29T20:00:00Z','2026-09-29T17:42:22Z','{"note": "All fixture events were replayed. No trading workflow ran; this is not a completed trade.", "total_events": 12}');
INSERT INTO "run_events" VALUES('evt_abfc7b5b4f034019bde15c5270e371cc','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',1,'RUN_CREATED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"init_key": "legacy-complete", "payload_hash": "fe607afab737d641a90e9a9b4dc78590adf7e29645d2bdb3d6343395a6f58cfd", "trading_enabled": true}');
INSERT INTO "run_events" VALUES('evt_330ee157bf4846149f5750c6964d8dae','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',2,'WATCHLIST_SET','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"symbols": ["SPY"]}');
INSERT INTO "run_events" VALUES('evt_c5ce4ada1fe94014a0db60e07a424868','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',3,'ACCOUNT_FUNDED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"account_id": "acct_af6e4ec76da4417e909de93050aa0e5a", "amount_cents": 10000000}');
INSERT INTO "run_events" VALUES('evt_daba946cfcee4837865dc3e486be7453','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',4,'FIXTURE_LOADED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"checksum": "sha256:c1ddc15c1ec857be9242761055e4cd6bbe70612ee47b8dd03faebf5ed680ce1c", "fixture_id": "sample_spy_worked_trade", "fixture_version": "1.0.0", "session_reference_cents": 59700, "total_events": 6}');
INSERT INTO "run_events" VALUES('evt_8c7a620ae9ce4b29980a3c85f73edc7c','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',5,'RUN_STARTED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"fixture_id": "sample_spy_worked_trade"}');
INSERT INTO "run_events" VALUES('evt_c4eae1c4e21d40c39499147e719b0a2b','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',6,'SESSION_OPEN','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"replay_position": 1}');
INSERT INTO "run_events" VALUES('evt_e71de7b5540947b6b2bf437b95e6c744','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',7,'QUOTE_ACCEPTED','2026-09-29T14:00:00Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "quote_id": "quo_388e178d68be42caa383eaf700ec0251", "replay_position": 2, "source_sequence": 1}');
INSERT INTO "run_events" VALUES('evt_3988e1f905b64bf2808844b84ea8aa5c','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',8,'PROPOSAL_CREATED','2026-09-29T14:00:00Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "intent": "BUY_TO_OPEN", "limit_cents": 400, "proposal_id": "prp_16defabdf5e74e06871c579789ca9e94", "quote_id": "quo_388e178d68be42caa383eaf700ec0251", "reason_code": "ENTRY_SIGNAL"}');
INSERT INTO "run_events" VALUES('evt_612377a0056243e1881fb7cb450a251d','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',9,'RISK_APPROVED','2026-09-29T14:00:00Z','2026-09-29T17:42:22Z','{"account_revision": 1, "proposal_id": "prp_16defabdf5e74e06871c579789ca9e94", "reason_codes": [], "required_cash_cents": 40065, "risk_decision_id": "rsk_c02c9af6e683422ea878f72f66cbb373"}');
INSERT INTO "run_events" VALUES('evt_c7bc9b54e2f94bb9833e98e04dcdd463','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',10,'ORDER_ACCEPTED','2026-09-29T14:00:00Z','2026-09-29T17:42:22Z','{"account_revision": 2, "expires_at": "2026-09-29T14:01:00Z", "intent": "BUY_TO_OPEN", "limit_cents": 400, "order_id": "ord_becfde51f28f40e9a51bc9955e3bdede", "reserved_cash_cents": 40065, "reserved_contracts": 0}');
INSERT INTO "run_events" VALUES('evt_9eef660d1fc24e66962e088610dac85b','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',11,'QUOTE_ACCEPTED','2026-09-29T14:00:01Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "quote_id": "quo_efc71bd7de024b93bd03fda9bd77125f", "replay_position": 3, "source_sequence": 2}');
INSERT INTO "run_events" VALUES('evt_45ee420ed7674635a04077054d0b7b1a','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',12,'ORDER_FILLED','2026-09-29T14:00:01Z','2026-09-29T17:42:22Z','{"account_revision": 3, "balance_after_cents": 9959935, "cost_basis_cents": 40065, "fee_cents": 65, "fill_id": "fil_d0a7e705839c4b91a6e241edd45ddcd6", "gross_cents": 40000, "intent": "BUY_TO_OPEN", "net_cash_delta_cents": -40065, "order_id": "ord_becfde51f28f40e9a51bc9955e3bdede", "position_id": "pos_8b11ff20934e4cc9bd781b8e204a535b", "price_cents": 400, "quote_id": "quo_efc71bd7de024b93bd03fda9bd77125f"}');
INSERT INTO "run_events" VALUES('evt_40f37911a06b42c3a8c0ed5d2f965b70','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',13,'QUOTE_ACCEPTED','2026-09-29T14:10:00Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "quote_id": "quo_f79653c8e37f4578b8cafe63d1ea0d7f", "replay_position": 4, "source_sequence": 3}');
INSERT INTO "run_events" VALUES('evt_aba039cac8994814bc9b5ba163d78ef5','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',14,'EXIT_INTENT_CREATED','2026-09-29T14:10:00Z','2026-09-29T17:42:22Z','{"position_id": "pos_8b11ff20934e4cc9bd781b8e204a535b", "reason_code": "PROFIT_TARGET", "requested_by": "STRATEGY"}');
INSERT INTO "run_events" VALUES('evt_0671b12b5ebc49d785eebe53e4e43f01','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',15,'PROPOSAL_CREATED','2026-09-29T14:10:00Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "intent": "SELL_TO_CLOSE", "limit_cents": 480, "proposal_id": "prp_5f5a750d925d4f3697ab81964f793dce", "quote_id": "quo_f79653c8e37f4578b8cafe63d1ea0d7f", "reason_code": "PROFIT_TARGET"}');
INSERT INTO "run_events" VALUES('evt_76fa6959d5f047bf96fff582db1151b7','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',16,'RISK_APPROVED','2026-09-29T14:10:00Z','2026-09-29T17:42:22Z','{"account_revision": 3, "proposal_id": "prp_5f5a750d925d4f3697ab81964f793dce", "reason_codes": [], "required_cash_cents": 0, "risk_decision_id": "rsk_cef88a243f5f45be87e9cb6e685ddcf1"}');
INSERT INTO "run_events" VALUES('evt_ca43f8a5612e464586e37489f19aa291','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',17,'ORDER_ACCEPTED','2026-09-29T14:10:00Z','2026-09-29T17:42:22Z','{"account_revision": 4, "expires_at": "2026-09-29T14:11:00Z", "intent": "SELL_TO_CLOSE", "limit_cents": 480, "order_id": "ord_265145d2cd2a4ed29894dcc5673eab53", "reserved_cash_cents": 0, "reserved_contracts": 1}');
INSERT INTO "run_events" VALUES('evt_785a209bdbff4d38935769e61a23ea93','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',18,'QUOTE_ACCEPTED','2026-09-29T14:10:01Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "quote_id": "quo_e23797bc62cb4dd4aa1fdb9bbc61aae3", "replay_position": 5, "source_sequence": 4}');
INSERT INTO "run_events" VALUES('evt_4c25af4aa8ca46dfb859f330289d2841','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',19,'ORDER_FILLED','2026-09-29T14:10:01Z','2026-09-29T17:42:22Z','{"account_revision": 5, "balance_after_cents": 10007870, "closed_trade_id": "trd_cbeb7a44ca784984964f6afd72a8644b", "fee_cents": 65, "fill_id": "fil_96670f37e4fc4b258078f5341c58bd76", "gross_cents": 48000, "intent": "SELL_TO_CLOSE", "net_cash_delta_cents": 47935, "order_id": "ord_265145d2cd2a4ed29894dcc5673eab53", "position_id": "pos_8b11ff20934e4cc9bd781b8e204a535b", "price_cents": 480, "quote_id": "quo_e23797bc62cb4dd4aa1fdb9bbc61aae3", "realized_pnl_cents": 7870}');
INSERT INTO "run_events" VALUES('evt_8b192925232c48849ab2bd727f727864','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',20,'SESSION_CLOSE','2026-09-29T20:00:00Z','2026-09-29T17:42:22Z','{"replay_position": 6}');
INSERT INTO "run_events" VALUES('evt_a34e42c0ea8c4360b0e1fbc59878f4e3','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',21,'REPLAY_EXHAUSTED','2026-09-29T20:00:00Z','2026-09-29T17:42:22Z','{"note": "All fixture events were replayed; the trading outcome is recorded separately as RUN_COMPLETED or RUN_INCOMPLETE.", "total_events": 6}');
INSERT INTO "run_events" VALUES('evt_b0506fcfbc7a4e46adc50c762bd29970','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f',22,'RUN_COMPLETED','2026-09-29T20:00:00Z','2026-09-29T17:42:22Z','{}');
INSERT INTO "run_events" VALUES('evt_8db956e1b5354c25bdac79504d0f8f30','run_40fb6057391f4fc58bb23e17f65acea1',1,'RUN_CREATED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"init_key": "legacy-partial", "payload_hash": "fe607afab737d641a90e9a9b4dc78590adf7e29645d2bdb3d6343395a6f58cfd", "trading_enabled": true}');
INSERT INTO "run_events" VALUES('evt_2c33d23d3a8e4ff5a1bdd7490c1f285a','run_40fb6057391f4fc58bb23e17f65acea1',2,'WATCHLIST_SET','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"symbols": ["SPY"]}');
INSERT INTO "run_events" VALUES('evt_14fa738f9d104c8792e5e4d506015491','run_40fb6057391f4fc58bb23e17f65acea1',3,'ACCOUNT_FUNDED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"account_id": "acct_4af932fb4da84d5fb6154f0a0e37df3f", "amount_cents": 10000000}');
INSERT INTO "run_events" VALUES('evt_84aa89be3b9944c09c6a10e119fd50b8','run_40fb6057391f4fc58bb23e17f65acea1',4,'FIXTURE_LOADED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"checksum": "sha256:c1ddc15c1ec857be9242761055e4cd6bbe70612ee47b8dd03faebf5ed680ce1c", "fixture_id": "sample_spy_worked_trade", "fixture_version": "1.0.0", "session_reference_cents": 59700, "total_events": 6}');
INSERT INTO "run_events" VALUES('evt_7c0da64a3ac443fa89520d3e9bb9e723','run_40fb6057391f4fc58bb23e17f65acea1',5,'RUN_STARTED','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"fixture_id": "sample_spy_worked_trade"}');
INSERT INTO "run_events" VALUES('evt_874c8fe5eebf44839283ac94a02c774c','run_40fb6057391f4fc58bb23e17f65acea1',6,'SESSION_OPEN','2026-09-29T13:30:00Z','2026-09-29T17:42:22Z','{"replay_position": 1}');
INSERT INTO "run_events" VALUES('evt_b900ae4bc37b4fda90bce23da56d83ec','run_40fb6057391f4fc58bb23e17f65acea1',7,'QUOTE_ACCEPTED','2026-09-29T14:00:00Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "quote_id": "quo_82aceb8ecb5f49c59b1cba616d3d05a8", "replay_position": 2, "source_sequence": 1}');
INSERT INTO "run_events" VALUES('evt_23d6cdf85d2a458fb055fff11dc087a8','run_40fb6057391f4fc58bb23e17f65acea1',8,'PROPOSAL_CREATED','2026-09-29T14:00:00Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "intent": "BUY_TO_OPEN", "limit_cents": 400, "proposal_id": "prp_d777e7508a9943c6b12c0b5854edd522", "quote_id": "quo_82aceb8ecb5f49c59b1cba616d3d05a8", "reason_code": "ENTRY_SIGNAL"}');
INSERT INTO "run_events" VALUES('evt_ec57fd51dda44dafb6fcc4fd131d4c3f','run_40fb6057391f4fc58bb23e17f65acea1',9,'RISK_APPROVED','2026-09-29T14:00:00Z','2026-09-29T17:42:22Z','{"account_revision": 1, "proposal_id": "prp_d777e7508a9943c6b12c0b5854edd522", "reason_codes": [], "required_cash_cents": 40065, "risk_decision_id": "rsk_761d5b6c85c24c67852121e8f39b1c96"}');
INSERT INTO "run_events" VALUES('evt_64c39659c5d34ea98dc0def8b6658e7a','run_40fb6057391f4fc58bb23e17f65acea1',10,'ORDER_ACCEPTED','2026-09-29T14:00:00Z','2026-09-29T17:42:22Z','{"account_revision": 2, "expires_at": "2026-09-29T14:01:00Z", "intent": "BUY_TO_OPEN", "limit_cents": 400, "order_id": "ord_1be66dddeaac4a5689596a7033e5be20", "reserved_cash_cents": 40065, "reserved_contracts": 0}');
INSERT INTO "run_events" VALUES('evt_1d28bd5168ad4403813d5a971cf855ee','run_40fb6057391f4fc58bb23e17f65acea1',11,'QUOTE_ACCEPTED','2026-09-29T14:00:01Z','2026-09-29T17:42:22Z','{"contract_id": "SPY_20261030_C_60000", "quote_id": "quo_2b3938c5636842c8ad6f7e7532017452", "replay_position": 3, "source_sequence": 2}');
INSERT INTO "run_events" VALUES('evt_ee8df636b5d64b30b16dc67c4a545574','run_40fb6057391f4fc58bb23e17f65acea1',12,'ORDER_FILLED','2026-09-29T14:00:01Z','2026-09-29T17:42:22Z','{"account_revision": 3, "balance_after_cents": 9959935, "cost_basis_cents": 40065, "fee_cents": 65, "fill_id": "fil_0222bbdf41384d33a8894bc74f3f88e6", "gross_cents": 40000, "intent": "BUY_TO_OPEN", "net_cash_delta_cents": -40065, "order_id": "ord_1be66dddeaac4a5689596a7033e5be20", "position_id": "pos_4a599e7c43a8451a87cd624a06dc940a", "price_cents": 400, "quote_id": "quo_2b3938c5636842c8ad6f7e7532017452"}');
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
    checkpoint_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint_event_sequence >= 0), trading_enabled INTEGER NOT NULL DEFAULT 0 CHECK (trading_enabled IN (0, 1)), status_reason TEXT,
    CHECK (session_end > session_start),
    -- Fixture metadata may be absent only before the run starts (SPEC.md 11.2).
    CHECK (status = 'READY' OR (session_reference_cents IS NOT NULL AND fixture_id IS NOT NULL
                                AND fixture_version IS NOT NULL AND fixture_checksum IS NOT NULL))
) STRICT;
INSERT INTO "runs" VALUES('run_71e5010f65974922afaa711e364d914d','legacy-replay','dc300d3114472647339ea9fbceb072fb183f5073d5e29311b4f527af9196b027','1.0','SAMPLE_PAPER',1,'READY','2026-09-29T17:42:22Z','USD',10000000,'sample_spy_long_call','1.0.0','risk_v1','next_quote_touch_v1','flat_65c_v1',65,100000,'America/New_York','2026-09-29T13:30:00Z','2026-09-29T20:00:00Z','2026-09-29T20:00:00Z',59700,'test_invalid_inputs','1.0.0','sha256:024fa3bdbe67067858f893256955f3a75387dc22a8e916b1f337942a19c50a82',17,0,NULL);
INSERT INTO "runs" VALUES('run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','legacy-complete','fe607afab737d641a90e9a9b4dc78590adf7e29645d2bdb3d6343395a6f58cfd','1.0','SAMPLE_PAPER',1,'COMPLETED','2026-09-29T17:42:22Z','USD',10000000,'sample_spy_long_call','1.0.0','risk_v1','next_quote_touch_v1','flat_65c_v1',65,100000,'America/New_York','2026-09-29T13:30:00Z','2026-09-29T20:00:00Z','2026-09-29T20:00:00Z',59700,'sample_spy_worked_trade','1.0.0','sha256:c1ddc15c1ec857be9242761055e4cd6bbe70612ee47b8dd03faebf5ed680ce1c',22,1,'Session ended flat; all fixture events processed.');
INSERT INTO "runs" VALUES('run_40fb6057391f4fc58bb23e17f65acea1','legacy-partial','fe607afab737d641a90e9a9b4dc78590adf7e29645d2bdb3d6343395a6f58cfd','1.0','SAMPLE_PAPER',1,'RUNNING','2026-09-29T17:42:22Z','USD',10000000,'sample_spy_long_call','1.0.0','risk_v1','next_quote_touch_v1','flat_65c_v1',65,100000,'America/New_York','2026-09-29T13:30:00Z','2026-09-29T20:00:00Z','2026-09-29T14:00:01Z',59700,'sample_spy_worked_trade','1.0.0','sha256:c1ddc15c1ec857be9242761055e4cd6bbe70612ee47b8dd03faebf5ed680ce1c',12,1,NULL);
CREATE TABLE schema_migrations (
               version    INTEGER PRIMARY KEY,
               name       TEXT NOT NULL,
               checksum   TEXT NOT NULL,
               applied_at TEXT NOT NULL
           ) STRICT;
INSERT INTO "schema_migrations" VALUES(1,'initial','90ef404d4487324ec95b8281b1729f0c87f0e74d01f55b275fca1c69c6478711','2026-09-29T17:42:22Z');
INSERT INTO "schema_migrations" VALUES(2,'sample_replay','39cad8650f69695eb44352a12acf0ea76975ad407503ebe7a4e8bbd9fb5c3c42','2026-09-29T17:42:22Z');
INSERT INTO "schema_migrations" VALUES(3,'trading_workflow','45e6c539056b9cc0d611e343cc90f42832538cedbac0087900315bb2608f087b','2026-09-29T17:42:22Z');
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
INSERT INTO "trade_proposals" VALUES('prp_16defabdf5e74e06871c579789ca9e94','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','acct_af6e4ec76da4417e909de93050aa0e5a','SPY_20261030_C_60000',NULL,'quo_388e178d68be42caa383eaf700ec0251','sample_spy_long_call','1.0.0','2026-09-29T14:00:00Z','BUY_TO_OPEN',1,400,'ENTRY_SIGNAL','Underlying 60000 cents is 50.25 bps above the 59700 cents reference (threshold 50 bps). Demonstration rules only; not a tested or profitable trading strategy.',2000,1000,1800,'run_ec8ead49a3d2491fb4a91bb0d2dd1a7f:BUY_TO_OPEN:after-event-7');
INSERT INTO "trade_proposals" VALUES('prp_5f5a750d925d4f3697ab81964f793dce','1.0','run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','acct_af6e4ec76da4417e909de93050aa0e5a','SPY_20261030_C_60000','pos_8b11ff20934e4cc9bd781b8e204a535b','quo_f79653c8e37f4578b8cafe63d1ea0d7f','sample_spy_long_call','1.0.0','2026-09-29T14:10:00Z','SELL_TO_CLOSE',1,480,'PROFIT_TARGET','Bid reached 120% of the entry fill price. Exit intent: PROFIT_TARGET. Sell limit = current bid. Demonstration rules only; not a tested or profitable trading strategy.',2000,1000,1800,'run_ec8ead49a3d2491fb4a91bb0d2dd1a7f:SELL_TO_CLOSE:after-event-14');
INSERT INTO "trade_proposals" VALUES('prp_d777e7508a9943c6b12c0b5854edd522','1.0','run_40fb6057391f4fc58bb23e17f65acea1','acct_4af932fb4da84d5fb6154f0a0e37df3f','SPY_20261030_C_60000',NULL,'quo_82aceb8ecb5f49c59b1cba616d3d05a8','sample_spy_long_call','1.0.0','2026-09-29T14:00:00Z','BUY_TO_OPEN',1,400,'ENTRY_SIGNAL','Underlying 60000 cents is 50.25 bps above the 59700 cents reference (threshold 50 bps). Demonstration rules only; not a tested or profitable trading strategy.',2000,1000,1800,'run_40fb6057391f4fc58bb23e17f65acea1:BUY_TO_OPEN:after-event-7');
CREATE TABLE watchlist_items (
    run_id   TEXT NOT NULL REFERENCES runs(run_id),
    symbol   TEXT NOT NULL CHECK (symbol = 'SPY'),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (run_id, symbol),
    UNIQUE (run_id, position)
) STRICT;
INSERT INTO "watchlist_items" VALUES('run_71e5010f65974922afaa711e364d914d','SPY',0);
INSERT INTO "watchlist_items" VALUES('run_ec8ead49a3d2491fb4a91bb0d2dd1a7f','SPY',0);
INSERT INTO "watchlist_items" VALUES('run_40fb6057391f4fc58bb23e17f65acea1','SPY',0);
CREATE UNIQUE INDEX ux_ledger_one_funding_per_run
    ON cash_ledger_entries(run_id) WHERE entry_type = 'INITIAL_FUNDING';
CREATE INDEX ix_orders_run_status ON orders(run_id, status);
CREATE INDEX ix_positions_run_status ON positions(run_id, status);
CREATE INDEX ix_quotes_run_event ON market_quotes(run_id, event_sequence);
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
CREATE INDEX ix_quotes_run_contract_event ON market_quotes(run_id, contract_id, event_sequence);
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
CREATE TRIGGER tr_replay_events_contiguous BEFORE INSERT ON replay_events
BEGIN
    SELECT RAISE(ABORT, 'replay_position must be contiguous')
    WHERE NEW.replay_position <> 1 + COALESCE(
        (SELECT MAX(replay_position) FROM replay_events WHERE run_id = NEW.run_id), 0);
    SELECT RAISE(ABORT, 'replay_position must equal the replay cursor')
    WHERE NEW.replay_position <> (SELECT next_position FROM replay_state WHERE run_id = NEW.run_id);
END;
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
CREATE TRIGGER tr_runs_fixture_set_once BEFORE UPDATE ON runs
WHEN OLD.fixture_checksum IS NOT NULL
 AND (NEW.fixture_id IS NOT OLD.fixture_id OR NEW.fixture_version IS NOT OLD.fixture_version
      OR NEW.fixture_checksum IS NOT OLD.fixture_checksum
      OR NEW.session_reference_cents IS NOT OLD.session_reference_cents)
BEGIN SELECT RAISE(ABORT, 'run fixture is pinned; create a new run to use a different fixture'); END;
CREATE TRIGGER tr_runs_clock_monotonic BEFORE UPDATE OF simulated_clock, checkpoint_event_sequence ON runs
BEGIN
    SELECT RAISE(ABORT, 'simulated clock cannot move backward')
    WHERE julianday(NEW.simulated_clock) < julianday(OLD.simulated_clock);
    SELECT RAISE(ABORT, 'checkpoint cannot move backward')
    WHERE NEW.checkpoint_event_sequence < OLD.checkpoint_event_sequence;
END;
CREATE INDEX ix_proposals_run_contract ON trade_proposals(run_id, contract_id, intent);
CREATE INDEX ix_fills_quote ON fills(quote_id);
CREATE TRIGGER tr_runs_trading_flag_fixed BEFORE UPDATE OF trading_enabled ON runs
WHEN NEW.trading_enabled IS NOT OLD.trading_enabled
BEGIN SELECT RAISE(ABORT, 'trading_enabled is fixed when a run is created'); END;
CREATE TRIGGER tr_runs_status_transition BEFORE UPDATE OF status ON runs
WHEN NEW.status IS NOT OLD.status
BEGIN
    SELECT RAISE(ABORT, 'replay-only runs stay READY; create a trading run')
    WHERE OLD.trading_enabled = 0;
    SELECT RAISE(ABORT, 'illegal run status transition')
    WHERE NOT ((OLD.status = 'READY' AND NEW.status = 'RUNNING')
            OR (OLD.status = 'RUNNING' AND NEW.status IN ('PAUSED','COMPLETED','INCOMPLETE'))
            OR (OLD.status = 'PAUSED' AND NEW.status IN ('RUNNING','INCOMPLETE')));
END;
CREATE TRIGGER tr_proposals_no_update BEFORE UPDATE ON trade_proposals
BEGIN SELECT RAISE(ABORT, 'trade proposals are immutable'); END;
CREATE TRIGGER tr_proposals_no_delete BEFORE DELETE ON trade_proposals
BEGIN SELECT RAISE(ABORT, 'trade proposals are immutable'); END;
CREATE TRIGGER tr_risk_no_update BEFORE UPDATE ON risk_decisions
BEGIN SELECT RAISE(ABORT, 'risk decisions are immutable'); END;
CREATE TRIGGER tr_risk_no_delete BEFORE DELETE ON risk_decisions
BEGIN SELECT RAISE(ABORT, 'risk decisions are immutable'); END;
CREATE TRIGGER tr_orders_terms_fixed BEFORE UPDATE ON orders
WHEN NEW.order_id IS NOT OLD.order_id OR NEW.run_id IS NOT OLD.run_id OR NEW.account_id IS NOT OLD.account_id
  OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.risk_decision_id IS NOT OLD.risk_decision_id
  OR NEW.contract_id IS NOT OLD.contract_id OR NEW.position_id IS NOT OLD.position_id
  OR NEW.intent IS NOT OLD.intent OR NEW.quantity IS NOT OLD.quantity OR NEW.limit_cents IS NOT OLD.limit_cents
  OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.after_source_sequence IS NOT OLD.after_source_sequence OR NEW.idempotency_key IS NOT OLD.idempotency_key
BEGIN SELECT RAISE(ABORT, 'order terms are immutable; use cancel-and-replace'); END;
CREATE TRIGGER tr_positions_entry_fixed BEFORE UPDATE ON positions
WHEN NEW.position_id IS NOT OLD.position_id OR NEW.run_id IS NOT OLD.run_id OR NEW.account_id IS NOT OLD.account_id
  OR NEW.contract_id IS NOT OLD.contract_id OR NEW.entry_fill_id IS NOT OLD.entry_fill_id
  OR NEW.opened_at IS NOT OLD.opened_at OR NEW.entry_price_cents IS NOT OLD.entry_price_cents
BEGIN SELECT RAISE(ABORT, 'position entry facts are immutable'); END;
CREATE TRIGGER tr_positions_closed_final BEFORE UPDATE ON positions
WHEN OLD.status = 'CLOSED'
BEGIN SELECT RAISE(ABORT, 'closed positions are final'); END;
CREATE TRIGGER tr_positions_no_delete BEFORE DELETE ON positions
BEGIN SELECT RAISE(ABORT, 'positions cannot be deleted'); END;
CREATE TRIGGER tr_fills_execution_rules BEFORE INSERT ON fills
BEGIN
    SELECT RAISE(ABORT, 'fill quote must come after the order''s generating quote')
    WHERE (SELECT q.source_sequence FROM market_quotes q WHERE q.quote_id = NEW.quote_id)
       <= (SELECT o.after_source_sequence FROM orders o WHERE o.order_id = NEW.order_id);
    SELECT RAISE(ABORT, 'fill quote predates order submission')
    WHERE julianday((SELECT q.observed_at FROM market_quotes q WHERE q.quote_id = NEW.quote_id))
        < julianday((SELECT o.submitted_at FROM orders o WHERE o.order_id = NEW.order_id));
    SELECT RAISE(ABORT, 'fill quote is for a different contract or run')
    WHERE NOT EXISTS (SELECT 1 FROM orders o JOIN market_quotes q ON q.contract_id = o.contract_id
                                                              AND q.run_id = o.run_id
                       WHERE o.order_id = NEW.order_id AND q.quote_id = NEW.quote_id AND o.run_id = NEW.run_id);
    SELECT RAISE(ABORT, 'fill quantity must equal the full order quantity')
    WHERE NEW.quantity <> (SELECT quantity FROM orders WHERE order_id = NEW.order_id);
    SELECT RAISE(ABORT, 'displayed quote size already consumed')
    WHERE NEW.quantity + COALESCE((SELECT SUM(f.quantity) FROM fills f JOIN orders o USING (order_id)
                                    WHERE f.quote_id = NEW.quote_id
                                      AND o.intent = (SELECT intent FROM orders WHERE order_id = NEW.order_id)), 0)
        > (SELECT CASE (SELECT intent FROM orders WHERE order_id = NEW.order_id)
                      WHEN 'BUY_TO_OPEN' THEN q.ask_size ELSE q.bid_size END
             FROM market_quotes q WHERE q.quote_id = NEW.quote_id);
    SELECT RAISE(ABORT, 'buy fills at the ask within the limit; sell fills at the bid within the limit')
    WHERE NOT EXISTS (
        SELECT 1 FROM orders o JOIN market_quotes q ON q.quote_id = NEW.quote_id
         WHERE o.order_id = NEW.order_id
           AND ((o.intent = 'BUY_TO_OPEN' AND NEW.price_cents = q.ask_cents AND q.ask_cents <= o.limit_cents)
             OR (o.intent = 'SELL_TO_CLOSE' AND NEW.price_cents = q.bid_cents AND q.bid_cents >= o.limit_cents)));
END;
CREATE TRIGGER tr_exit_intents_rules BEFORE UPDATE ON exit_intents
BEGIN
    SELECT RAISE(ABORT, 'exit intent identity and reason are immutable')
    WHERE NEW.position_id IS NOT OLD.position_id OR NEW.reason_code IS NOT OLD.reason_code
       OR NEW.requested_by IS NOT OLD.requested_by OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'resolved exit intents are final')
    WHERE OLD.resolved_at IS NOT NULL;
END;
CREATE TRIGGER tr_exit_intents_no_delete BEFORE DELETE ON exit_intents
BEGIN SELECT RAISE(ABORT, 'exit intents cannot be deleted'); END;
COMMIT;
