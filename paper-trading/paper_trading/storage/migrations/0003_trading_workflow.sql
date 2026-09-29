-- 0003_trading_workflow: Step 5 trading-enabled runs, exit intents, and trading guards.
-- Adds columns, tables, and triggers only; 0001 and 0002 are never edited.
-- Existing runs keep trading_enabled = 0 (replay-only), so their Step 4 results are untouched.

ALTER TABLE runs ADD COLUMN trading_enabled INTEGER NOT NULL DEFAULT 0 CHECK (trading_enabled IN (0, 1));
ALTER TABLE runs ADD COLUMN status_reason TEXT;

-- Persistent exit intent (SPEC.md clarification 3): created when an exit rule
-- first triggers or the user requests a close; survives cancellation,
-- expiration, and restart; resolved only by the closing fill.
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

CREATE INDEX ix_proposals_run_contract ON trade_proposals(run_id, contract_id, intent);
CREATE INDEX ix_fills_quote ON fills(quote_id);

-- Trading flag is fixed at creation; replay-only runs never leave READY.
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

-- Proposals and risk decisions are audit records.
CREATE TRIGGER tr_proposals_no_update BEFORE UPDATE ON trade_proposals
BEGIN SELECT RAISE(ABORT, 'trade proposals are immutable'); END;
CREATE TRIGGER tr_proposals_no_delete BEFORE DELETE ON trade_proposals
BEGIN SELECT RAISE(ABORT, 'trade proposals are immutable'); END;
CREATE TRIGGER tr_risk_no_update BEFORE UPDATE ON risk_decisions
BEGIN SELECT RAISE(ABORT, 'risk decisions are immutable'); END;
CREATE TRIGGER tr_risk_no_delete BEFORE DELETE ON risk_decisions
BEGIN SELECT RAISE(ABORT, 'risk decisions are immutable'); END;

-- Orders: only status, timestamps, reservations, and terminal reason may change.
CREATE TRIGGER tr_orders_terms_fixed BEFORE UPDATE ON orders
WHEN NEW.order_id IS NOT OLD.order_id OR NEW.run_id IS NOT OLD.run_id OR NEW.account_id IS NOT OLD.account_id
  OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.risk_decision_id IS NOT OLD.risk_decision_id
  OR NEW.contract_id IS NOT OLD.contract_id OR NEW.position_id IS NOT OLD.position_id
  OR NEW.intent IS NOT OLD.intent OR NEW.quantity IS NOT OLD.quantity OR NEW.limit_cents IS NOT OLD.limit_cents
  OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.after_source_sequence IS NOT OLD.after_source_sequence OR NEW.idempotency_key IS NOT OLD.idempotency_key
BEGIN SELECT RAISE(ABORT, 'order terms are immutable; use cancel-and-replace'); END;

-- Positions: entry facts never change; a closed position is final.
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

-- Fills: never from the quote that generated the order (or any earlier quote),
-- never from a quote that predates submission, never beyond displayed size.
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
