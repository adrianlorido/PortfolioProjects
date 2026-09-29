# Options Paper-Trading MVP — Specification

Source of truth for the `paper-trading/` application. Sections 1–9 are the
approved design (project Steps 1 and 2). Section 10 records the approved
clarifications, which **take precedence** over Sections 1–9 where they differ.
Section 11 records implementation resolutions of contradictions and routine
details made during Step 3.

The MVP is one local app with a deterministic paper-trading engine, a SQLite
database, and a browser dashboard. It uses a fixed sample-data replay to
demonstrate a complete trade.

---

## 1. Architecture and approved defaults

| Setting | Default |
|---|---|
| Virtual account | USD, starting cash $100,000 |
| Watchlist | SPY |
| Strategy | One rule-based long-call strategy |
| Position limit | One open position or pending entry |
| Order quantity | One contract |
| Entry risk ceiling | 1% of starting cash, including entry fee |
| Fees | $0.65 per contract per fill, a configurable simulation assumption |
| Execution | Limit orders; buy at ask, sell at bid when eligible |
| Data | Versioned synthetic fixture with a simulated clock |
| Deployment | Local machine, one backend process |
| Mode | `SAMPLE_PAPER` only |

Starting cash and fees become immutable when a run starts. Changing them
creates a new run, preserving the original results.

### Module responsibilities

| Module | Owns | Boundary |
|---|---|---|
| Market data | Contract definitions, normalized quotes, source metadata | Supplies data; cannot place orders |
| Strategy | Versioned rules, entry/exit proposals | Proposes trades; cannot change balances |
| Risk | Approval/rejection records | Checks proposals; cannot execute |
| Paper broker | Order lifecycle, fill eligibility, reservations | Executes approved proposals under fixed rules |
| Accounting | Cash ledger, position accounting, closed-trade results | Calculates money and ownership from fills |
| Storage | Transactions, uniqueness, referential integrity, replay checkpoint | Persists records atomically |
| Dashboard | Read models and user commands | Displays backend calculations; never computes authoritative balances |

A small application coordinator processes events in order and connects these
modules.

### Technology stack

| Component | Choice | Reason and tradeoff |
|---|---|---|
| Backend | Python + FastAPI | Clear interfaces and validation |
| Dashboard | Server-rendered HTML with lightweight JavaScript | One application to run |
| Database | SQLite | One local account and one writer; move to PostgreSQL if concurrent services become necessary |
| Money | Integer cents; exact decimal arithmetic for ratios | Avoids floating-point accounting errors |
| Validation | Pydantic models with a documented JSON contract | Centralized input validation |
| Verification | pytest | Focused accounting, execution, and recovery checks |

SQLite transaction behavior must be configured explicitly.

---

## 2. Demonstration strategy

Strategy identifier: `sample_spy_long_call`, version `1.0.0`. These rules
demonstrate the infrastructure. They are not a tested trading edge.

### Entry

Evaluate each valid sample quote while flat:

1. Underlying must be SPY.
2. Current underlying price must be at least 0.5% above the session reference price.
3. Contract must be a standard, unadjusted call with a multiplier of 100.
4. Expiration must be 30–45 calendar days away, measured using the simulated date in America/New_York.
5. Strike must be the lowest eligible strike at or above the underlying price.
6. If multiple contracts qualify, select earliest expiration, then lowest strike, then contract ID.
7. Bid must be positive; ask must be greater than or equal to bid.
8. Spread must be no more than 5% of ask.
9. Quote and underlying observation must each be no more than 2 simulated seconds old.
10. Proposed quantity is one contract and proposed buy limit equals the observed ask.
11. Entry cost plus fee must fit both available cash and the $1,000 risk ceiling.

No averaging down, additional entries, or re-entry after a completed trade
within the same run.

### Exit

On each subsequent valid quote, propose closing the entire position when the
first applicable condition occurs:

| Condition | Trigger |
|---|---|
| Profit target | Bid ≥ 120% of entry fill price |
| Loss threshold | Bid ≤ 90% of entry fill price |
| Time exit | Simulated time ≥ 30 minutes after entry |
| Manual close | User requests a closing proposal |

A closing proposal uses the current bid as its sell limit. Target and loss
triggers use premium prices before fees; reported P&L includes fees. The loss
threshold is an exit trigger, not a guaranteed maximum loss.

---

## 3. Workflow, execution, and accounting

1. Normalize and persist a quote.
2. Evaluate the strategy using only information available at that event.
3. Persist a proposal and risk decision.
4. If approved, create an order and reserve cash or contracts.
5. Evaluate the order against the next eligible quote event.
6. If executable, persist the fill and accounting changes together.
7. Update the dashboard.
8. Generate and execute a closing proposal.
9. Record the closed trade and reconcile the account.

An order cannot fill from the same quote that caused its proposal.

### Fill model

| Order | Eligibility | Fill price |
|---|---|---|
| Buy to open | Ask ≤ buy limit; sufficient displayed ask size | Ask |
| Sell to close | Bid ≥ sell limit; sufficient displayed bid size | Bid |

- Fills are all-or-none; displayed size is measured in contracts.
- Missing size means no fill.
- A quote's displayed capacity cannot be reused for multiple fills.
- No midpoint fills, price improvement, random fills, hidden liquidity, or additional slippage model.
- Displayed quotes do not guarantee real execution.

### Quote validation

Reject execution against a quote when:

- Prices or sizes are negative, required fields are missing, or bid exceeds ask.
- Its observation time is in the simulated future or more than two seconds old.
- Its source sequence is duplicated or moves backward.
- Its contract, run, or source does not match the order.
- It arrives outside the fixture's permitted session.
- It predates order submission.

Invalid inputs are logged with reasons and do not advance the strategy's valid
market state.

### Order lifecycle

| From | To | Cause |
|---|---|---|
| PENDING | OPEN | Approval and reservation committed |
| PENDING | REJECTED | Validation or risk rejection |
| OPEN | FILLED | Eligible executable quote |
| OPEN | CANCELED | User or coordinator cancellation |
| OPEN | EXPIRED | Order TTL or sample-session end |

Terminal states cannot change. `EXPIRED` means order expiration, not option
expiration. Every order has a 60-second simulated TTL; at the expiration
timestamp, expiration is processed before quotes. Cancel and fill requests are
processed serially; whichever commits first determines the outcome. Orders
cannot be edited; use cancel-and-replace.

### Cash and positions

For quantity q, multiplier m, premium p:

- Entry cash debit = p × m × q + entry fee
- Closing cash credit = p × m × q − exit fee
- Position cost basis = entry premium total + entry fee
- Realized P&L = closing credit − position cost basis

While a buy order is open:

- Reserved cash = limit × multiplier × quantity + expected entry fee
- Available cash = cash − reserved cash
- Reservation changes available cash, not cash itself.
- Filling releases the reservation and deducts actual cost.
- Canceling or expiring releases the reservation without a cash debit.

A sell order reserves the position's contracts.

Open positions are marked at the latest valid bid:

- Market value = bid × multiplier × quantity
- Unrealized P&L = market value − cost basis
- Equity = cash + market value

Unrealized P&L excludes the prospective exit fee; display that convention
beside the number. A stale mark is retained and labeled stale; never silently
substitute zero.

### Persistence and recovery

One database transaction commits: order transition and fill, ledger entry,
reservation release, position change, closed-trade record (if applicable), and
replay checkpoint. An accepted order and its reservation also commit
atomically. Risk approval is bound to an account revision; acceptance rechecks
that revision and available funds.

Each command has an idempotency key: same key and same payload returns the
original result; same key and different payload is rejected as a conflict.

A restart reloads the last committed checkpoint, reconciles ledger and
positions, and resumes without duplicating fills. Reconciliation failure pauses
the run.

---

## 4. Supported scope and enforced exclusions

| Deferred capability | MVP enforcement |
|---|---|
| Live trading | No live broker adapter or real-order endpoint |
| Live market data | Only the registered synthetic fixture provider is accepted |
| Partial fills | Require full displayed size; otherwise leave order open |
| Short options and spreads | Reject anything except single-leg buy-to-open/sell-to-close |
| Adjusted contracts | Require standard deliverable and multiplier 100 |
| Exercise and assignment | No exercise instruction or short position support |
| Option expiration | Fixture dates must remain at least seven days before expiration |
| Overnight positions | Sample session must close flat |
| Settlement rules | Sample cash is immediately reusable; no claim of cash-account compliance |
| AI and backtesting research | No learning loop or profitability assessment |

If a fixture ends with a position open, mark the run `INCOMPLETE` and show the
remaining exposure. Never invent a closing fill or realized profit.

---

## 5. Shared schema conventions

- Every record has `schema_version: "1.0"`.
- IDs are opaque nonempty strings.
- Timestamps are RFC 3339 UTC strings ending in `Z`. Dates use `YYYY-MM-DD`.
- `*_cents` fields are signed 64-bit integers; nonnegative unless noted.
- Premium and strike cents are per underlying share, not per contract.
- Counts and sequences are integers. Ratios use integer basis points.
- Required-but-unknown values are `null` only where permitted.
- Unknown fields and unsupported schema versions are rejected.
- Each run pins its strategy, risk policy, execution model, fee schedule, and fixture versions.
- Every execution/accounting record belongs to a `run_id`; the run fixes `mode: "SAMPLE_PAPER"` and `is_sample: true`.

A **Run** record holds starting cash, watchlist, versions, simulated clock,
session boundaries, fixture checksum, checkpoint, and status: `READY`,
`RUNNING`, `PAUSED`, `COMPLETED`, or `INCOMPLETE`.

### A. Option contract (market data)

```json
{
  "schema_version": "1.0", "contract_id": "c1", "underlying": "SPY",
  "expiration_date": "2026-10-30", "option_type": "CALL", "strike_cents": 60000,
  "currency": "USD", "multiplier": 100, "deliverable": "100_SPY_SHARES",
  "exercise_style": "AMERICAN", "settlement_type": "PHYSICAL", "adjusted": false
}
```

`option_type` permits CALL or PUT; the MVP rejects puts for trading. Strike and
multiplier positive. Economic identity is unique across underlying, expiration,
type, strike, currency, and deliverable.

### B. Market quote (market data)

```json
{
  "schema_version": "1.0", "quote_id": "q1", "run_id": "r1", "contract_id": "c1",
  "source": "synthetic_fixture_v1", "is_sample": true, "source_sequence": 1,
  "observed_at": "2026-09-29T14:00:00Z", "received_at": "2026-09-29T14:00:00Z",
  "bid_cents": 390, "ask_cents": 400, "bid_size": 10, "ask_size": 10,
  "underlying_price_cents": 60000, "underlying_observed_at": "2026-09-29T14:00:00Z",
  "session_reference_cents": 59700
}
```

Prices and sizes nonnegative; ask, underlying, and reference positive; bid ≤
ask. Source sequence unique within run and source. (See clarification 2 for
`session_reference_cents`.)

### C. Trade proposal (strategy)

```json
{
  "schema_version": "1.0", "proposal_id": "p1", "run_id": "r1", "account_id": "a1",
  "contract_id": "c1", "position_id": null, "quote_id": "q1",
  "strategy_id": "sample_spy_long_call", "strategy_version": "1.0.0",
  "created_at": "2026-09-29T14:00:00Z", "intent": "BUY_TO_OPEN", "quantity": 1,
  "limit_cents": 400, "reason_code": "ENTRY_SIGNAL",
  "reason": "Underlying exceeded the 0.5% entry threshold.",
  "exit_rules": {"profit_target_bps": 2000, "loss_threshold_bps": 1000, "max_hold_seconds": 1800},
  "idempotency_key": "r1-entry-q1"
}
```

`position_id` null for entry, required for closing. Intent `BUY_TO_OPEN` or
`SELL_TO_CLOSE`. Reason codes: `ENTRY_SIGNAL`, `PROFIT_TARGET`,
`LOSS_THRESHOLD`, `TIME_EXIT`, `MANUAL_CLOSE`, `EXIT_RETRY`.

### D. Risk decision (risk)

```json
{
  "schema_version": "1.0", "risk_decision_id": "rd1", "run_id": "r1", "proposal_id": "p1",
  "evaluated_at": "2026-09-29T14:00:00Z", "policy_version": "risk_v1",
  "account_revision": 1, "decision": "APPROVED", "reason_codes": [],
  "required_cash_cents": 40065, "available_cash_cents": 10000000,
  "entry_risk_cents": 40065, "entry_risk_limit_cents": 100000
}
```

Rejected decisions require at least one reason code: `INSUFFICIENT_CASH`,
`RISK_LIMIT`, `POSITION_LIMIT`, `INVALID_QUOTE`, `UNSUPPORTED_CONTRACT`,
`INSUFFICIENT_POSITION`, `STALE_ACCOUNT_REVISION`. For closes, required cash
and entry risk are zero.

### E. Order (paper broker)

```json
{
  "schema_version": "1.0", "order_id": "o1", "run_id": "r1", "account_id": "a1",
  "proposal_id": "p1", "risk_decision_id": "rd1", "contract_id": "c1", "position_id": null,
  "intent": "BUY_TO_OPEN", "quantity": 1, "limit_cents": 400, "status": "OPEN",
  "submitted_at": "2026-09-29T14:00:00Z", "updated_at": "2026-09-29T14:00:00Z",
  "expires_at": "2026-09-29T14:01:00Z", "after_source_sequence": 1,
  "reserved_cash_cents": 40065, "reserved_contracts": 0,
  "idempotency_key": "r1-order-p1", "terminal_reason": null
}
```

Terminal reason required for rejection, cancellation, or expiration. Buy
orders reserve cash; sell orders reserve contracts. Terminal orders retain no
reservations.

### F. Fill (paper broker, immutable)

```json
{
  "schema_version": "1.0", "fill_id": "f1", "run_id": "r1", "order_id": "o1", "quote_id": "q2",
  "filled_at": "2026-09-29T14:00:01Z", "quantity": 1, "price_cents": 400, "multiplier": 100,
  "gross_cents": 40000, "fee_cents": 65,
  "execution_model_version": "next_quote_touch_v1", "fee_schedule_version": "flat_65c_v1"
}
```

gross = price × multiplier × quantity. One fill per order.

### G. Position (accounting)

```json
{
  "schema_version": "1.0", "position_id": "pos1", "run_id": "r1", "account_id": "a1",
  "contract_id": "c1", "entry_fill_id": "f1", "opened_at": "2026-09-29T14:00:01Z",
  "closed_at": null, "status": "OPEN", "quantity": 1, "reserved_contracts": 0,
  "entry_price_cents": 400, "remaining_cost_basis_cents": 40065, "mark_quote_id": "q2",
  "market_value_cents": 39000, "unrealized_pnl_cents": -1065, "valuation_status": "CURRENT"
}
```

Closed positions have zero quantity, reserved contracts, remaining basis,
market value, and unrealized P&L.

### H. Account snapshot (accounting read model)

```json
{
  "schema_version": "1.0", "snapshot_id": "as1", "run_id": "r1", "account_id": "a1",
  "account_revision": 3, "as_of": "2026-09-29T14:00:01Z", "currency": "USD",
  "starting_cash_cents": 10000000, "cash_cents": 9959935, "reserved_cash_cents": 0,
  "available_cash_cents": 9959935, "market_value_cents": 39000, "equity_cents": 9998935,
  "realized_pnl_cents": 0, "unrealized_pnl_cents": -1065, "fees_paid_cents": 65,
  "valuation_status": "CURRENT"
}
```

Snapshots are derived records, not an independent source of cash truth.

### I. Cash ledger entry (accounting, immutable)

```json
{
  "schema_version": "1.0", "ledger_entry_id": "l2", "run_id": "r1", "account_id": "a1",
  "ledger_sequence": 2, "recorded_at": "2026-09-29T14:00:01Z", "entry_type": "BUY_FILL",
  "fill_id": "f1", "premium_cash_delta_cents": -40000, "fee_cash_delta_cents": -65,
  "net_cash_delta_cents": -40065, "balance_after_cents": 9959935
}
```

Entry type `INITIAL_FUNDING`, `BUY_FILL`, or `SELL_FILL`; `fill_id` null only
for initial funding. net = premium delta + fee delta; fee delta nonpositive. One
funding entry per run and one ledger entry per fill. No deposits, withdrawals,
or manual corrections.

### J. Closed-trade record (accounting, immutable)

```json
{
  "schema_version": "1.0", "closed_trade_id": "t1", "run_id": "r1", "position_id": "pos1",
  "entry_fill_id": "f1", "exit_fill_id": "f2", "strategy_id": "sample_spy_long_call",
  "strategy_version": "1.0.0", "opened_at": "2026-09-29T14:00:01Z",
  "closed_at": "2026-09-29T14:10:01Z", "quantity": 1, "entry_cost_cents": 40065,
  "exit_net_proceeds_cents": 47935, "total_fees_cents": 130, "realized_pnl_cents": 7870,
  "exit_reason": "PROFIT_TARGET"
}
```

Realized P&L = net proceeds − entry cost. One closed-trade record per position.

Traceability: closed trade → fills → orders → risk decisions and proposals → input quotes.

---

## 6. Module interfaces

| Owner | Interface | Result |
|---|---|---|
| Market data | `next_event(run_id, checkpoint)` | Next quote or session boundary |
| Market data | `get_contract(contract_id)` | Immutable contract |
| Strategy | `evaluate(event, account, position, strategy_config)` | Proposal or no action |
| Risk | `evaluate(proposal, account, position, quote, policy)` | Persistable risk decision |
| Broker | `submit(proposal_id, idempotency_key)` | Accepted or rejected order |
| Broker | `on_quote(quote_id)` | Eligible fill candidates |
| Broker | `cancel(order_id, idempotency_key)` | Order transition |
| Accounting | `apply_fill(fill, transaction)` | Ledger and position changes |
| Accounting | `reconcile(run_id)` | Pass/fail with discrepancies |
| Query layer | `get_dashboard(run_id)` | Snapshot, positions, orders, history |
| Coordinator | `start`, `step`, `pause`, `request_close` | Audited commands |

`apply_fill` runs inside the coordinator's atomic transaction. Dashboard
requests use command interfaces; they cannot write tables directly.

---

## 7. Worked sample trade (synthetic prices)

| Event | Result |
|---|---|
| Start | Cash $100,000.00 |
| 14:00:00 — q1 | SPY $600 vs $597 reference; call bid $3.90 / ask $4.00 |
| Entry proposal | Buy one Oct 30 $600 call, limit $4.00 |
| Risk approval | $400.65 required; below $1,000 ceiling |
| Order accepted | Cash $100,000.00; available $99,599.35 |
| 14:00:01 — q2 | Buy fills at $4.00 |
| After entry | Cash $99,599.35; cost basis $400.65 |
| Initial bid valuation | Position value $390.00; unrealized −$10.65 |
| 14:10:00 — q3 | Bid $4.80 / ask $4.90 triggers profit target |
| Exit proposal | Sell one contract, limit $4.80 |
| 14:10:01 — q4 | Sell fills at $4.80 |
| Final account | Cash and equity $100,078.70, no position |

$100,000 − $400 − $0.65 + $480 − $0.65 = $100,078.70; realized P&L $78.70.
Immediately after entry: $99,599.35 + $390 = $99,989.35 = $100,000 − $10.65.

---

## 8. Acceptance checklist

| Check | Required outcome |
|---|---|
| Buy limit | $4.00 limit cannot fill at $4.01 ask |
| Sell limit | $4.80 limit cannot fill at $4.79 bid |
| Same-event execution | Proposal quote cannot fill its own order |
| Quote integrity | Stale, future, crossed, duplicate, and out-of-order quotes cannot fill |
| Liquidity | Insufficient or missing displayed size prevents fill |
| Cash reservation | Pending orders cannot collectively exceed available funds |
| Position reservation | Duplicate exits cannot sell more contracts than owned |
| Cancellation | Releases reservation without changing cash |
| Idempotency | Repeated command creates no duplicate order, fill, or ledger debit |
| Risk rejection | Leaves cash and positions unchanged |
| Round trip | Sample trade ends at $100,078.70 with $78.70 realized profit |
| Ledger reconciliation | Cash equals the sum of all ledger deltas |
| Equity reconciliation | Starting cash + realized + unrealized P&L = equity when valuation available |
| Crash recovery | Crash before commit changes nothing; crash after commit cannot double-apply |
| Deterministic replay | Same fixture and versions produce identical economic results |
| Scope enforcement | Unsupported contracts and lifecycle events are rejected or pause the run |
| Incomplete fixture | Open exposure remains visible; no fabricated closing P&L |

---

## 9. Implementation sequence

1. Establish repository, configuration, schemas, migrations, and sample fixture.
2. Implement ledger, reservations, and position accounting with reconciliation checks.
3. Implement risk decisions and deterministic order execution.
4. Connect strategy, replay clock, and restart recovery.
5. Build dashboard and run the complete acceptance checklist.

---

## 10. Approved clarifications (take precedence)

1. **Rejected entries.** After a rejected entry, enforce a 60-second
   simulated-time cooldown per contract before proposing another entry. Do
   not permanently disable the contract after a risk rejection.
2. **Reference price.** Store the fixed session reference price in run/fixture
   metadata. If a quote includes it, require an exact match.
3. **Pending exits.** Do not generate another closing proposal while a closing
   order is pending or open. Preserve the exit intent after cancellation or
   expiration so it can retry on the next eligible quote.
4. **Replay determinism.** Identical inputs and versions must produce identical
   economic results and event ordering. Use deterministic event sequence
   numbers within each run and globally unique record IDs. Different runs may
   have different IDs.
5. **Session times.** Store session boundaries as UTC timestamps and store
   `America/New_York` as the session timezone. Derive local dates using that
   timezone; never use a fixed UTC offset.
6. **Account revision.** Increment `account_revision` whenever a committed
   change affects cash, positions, or cash/contract reservations — including
   order acceptance, cancellation, expiration, and fills, not only ledger
   entries. The increment commits in the same transaction as the change.
   Risk approvals record the revision they evaluated; order acceptance must
   atomically (inside one `BEGIN IMMEDIATE` transaction) recheck that revision
   and revalidate available cash and available (unreserved) contracts before
   committing the order and its reservation. A mismatch rejects with
   `STALE_ACCOUNT_REVISION`.
7. **Milestone numbering.** Step 3 is the project foundation (repository,
   backend, database, read-only dashboard). Step 4 is sample-data mode
   (versioned synthetic fixture, fixture loading, quote validation, replay
   clock, and event sequencing). Step 5 is the complete trading workflow
   (strategy, risk, order acceptance and reservations, fills, position and
   fill accounting, closed trades, and restart recovery).

---

## 11. Implementation resolutions (Step 3)

Contradictions and gaps found while implementing, and how they were resolved.

1. **Quote `session_reference_cents` required vs. optional.** Section 5B says
   every quote field is required; clarification 2 says "if a quote includes
   it". Clarification wins: the field is optional (may be omitted or `null`)
   on a quote; when present it must equal the run's stored reference exactly.
   The quote model validates shape; the exact-match check against the run's
   pinned reference is done at quote intake (implemented in Step 4, §12).
2. **Run fixture metadata before a fixture exists.** A run must pin its fixture
   version, checksum, and session reference price, but the fixture is built in
   Step 4. These run columns are nullable while the run is `READY` and a
   database CHECK requires them for every other status, so a run cannot start
   without them.
3. **Account record.** The spec references `account_id` but defines no Account
   schema. Added a minimal `Account` (one per run in the MVP) holding currency,
   starting cash, and `account_revision`. Cash is never stored on it; cash is
   the sum of ledger deltas.
4. **Account revision.** Starts at 1 when the initial funding commits, then
   follows clarification 6. This matches the examples (risk decision at
   revision 1, snapshot at revision 3 after reservation and fill). In Step 3
   initialization is the only state change; the database already rejects any
   revision that does not increase. The focused test that reservation changes
   bump the revision is added in Step 5 with the reservation code.
5. **Snapshot identity.** Snapshots are computed on read, not stored as cash
   truth. `snapshot_id` is derived as `<account_id>:r<revision>`, which is
   globally unique because account IDs are. The `account_snapshots` table
   exists for later checkpointing.
6. **Funding timestamp.** The initial-funding ledger entry is recorded at the
   run's simulated session start (not wall-clock time) so identical inputs
   produce identical economic records.
7. **Watchlist.** The MVP only permits `SPY`; configuration naming other
   symbols is rejected rather than silently ignored.
8. **Initialization idempotency.** Initialization is a command with an
   idempotency key (the configured sample-run key). Same key and same
   parameters return the existing run; same key and different parameters is
   a conflict — change the key to create a new run.
9. **Rejection cooldown storage.** The 60-second cooldown (clarification 1) is
   derivable from persisted risk decisions and proposals; no extra table is
   added in Step 3.
10. **Step numbering.** See clarification 7. Section 9's original sequence
    is superseded by it.

---

## 12. Implementation resolutions (Step 4: sample-data mode)

1. **Fixture format.** One JSON document per fixture version with metadata,
   in-scope contracts, and an ordered event timeline: `SESSION_OPEN` at the
   session start, `QUOTE` events, and `SESSION_CLOSE` at the session end.
   Each event's `at` is its scheduled simulated arrival time.
2. **Checksum.** `sha256:` + SHA-256 of the canonical JSON (sorted keys, no
   whitespace, UTF-8) of the document without its `checksum` field.
   Formatting changes do not alter it; any value change does. Changed content
   requires a new `fixture_version`: the same id and version with different
   content is refused.
3. **Load-time vs intake-time validation.** Loading validates structure,
   checksum, metadata, contract scope (Section 4), and that the fixture's
   session equals the run's pinned session. Quote content is validated at
   intake, so invalid inputs are recorded with reasons rather than failing
   the load.
4. **Pinning.** Loading sets the run's fixture id, version, checksum, and
   session reference price once. The database refuses later changes in any
   status. A different fixture requires a new run (new sample-run key).
   Loading the same fixture again is a no-op.
5. **Clock.** The simulated clock moves only to each event's scheduled time.
   Observation timestamps are validated against it and never set it. The
   database refuses to move the clock or checkpoint backward.
6. **Numbering.** `replay_position` is the fixture event index and the replay
   cursor. `run_events.event_sequence` is the run's audit order (setup,
   replay, pause/resume). `source_sequence` is provider data, validated per
   run and source against accepted quotes only (see `market_data/intake.py`).
   Rejected inputs never advance the high-water mark.
7. **Rejected inputs.** Rejected inputs are stored as received, with ordered
   reason codes, in `rejected_inputs`, separate from `market_quotes`. Market
   state reads only accepted quotes.
8. **Staleness boundary.** A quote is stale when it is more than 2 simulated
   seconds older than the clock (exactly 2 seconds is still fresh). Future
   observations are rejected. Dashboard freshness uses the same limit on the
   simulated clock.
9. **Run status during replay.** The run stays `READY` in Step 4. Replay
   progress is tracked in `replay_state` (`ACTIVE`/`PAUSED`/`EXHAUSTED`).
   Exhaustion is recorded as a `REPLAY_EXHAUSTED` run event and is not a
   `COMPLETED` run, because no trading workflow runs.
10. **Commands.** Step, pause, resume, and run-to-end carry idempotency keys
    stored in `command_log`, with the SPEC Section 3 conflict semantics.
    Run-to-end commits one transaction per event, so an interruption keeps
    completed events and a retry with the same key resumes. Its command
    record is written once at the end.
11. **Worked-example gap.** Section 7 gives no underlying price for q3/q4; the
    fixture uses $601.50 (60150 cents). Sizes are 10 contracts on both sides.
    The contract ID is `SPY_20261030_C_60000`.
12. **HTTP loading.** The API loads only fixtures bundled in
    `paper-trading/fixtures/`, by id. Test fixtures and arbitrary paths are
    CLI-only.

---

## 13. Implementation resolutions (Step 5: trading workflow)

No approved trading or accounting rule was changed. The worked example
reproduces exactly: entry 1 @ $4.00 + $0.65, exit 1 @ $4.80 − $0.65, realized
$78.70, final cash and equity $100,078.70, no open position or reservations.
The account revision reaches 2 at acceptance and 3 at the entry fill, matching
records D and H. The points below are interpretations where the spec was
silent or ambiguous; items 1–4 are flagged for review.

1. **Entry rule 11 (cash and risk ceiling) is enforced by the risk decision,
   not pre-filtered by the strategy (flagged).** Section 2 lists it as an
   entry rule, while clarification 1 presumes entries can be rejected. The
   strategy proposes; `risk_v1` rejects with `INSUFFICIENT_CASH`/`RISK_LIMIT`,
   which is persisted and starts the 60-second cooldown. Either way no order
   is created. This way the rejection is auditable.
2. **Revision granularity (flagged).** Clarification 6 is applied per
   committed operation: order acceptance, fill, cancellation, and expiration
   each increment `account_revision` once. Marking a position to market
   changes valuation only (not cash, holdings, or reservations) and does not
   increment it. This reproduces records D (revision 1 at approval) and H
   (revision 3 after acceptance and fill).
3. **Orders exist only for approved decisions (flagged).** A risk-rejected
   proposal creates no order. `PENDING → REJECTED` is used when acceptance
   revalidation fails (`STALE_ACCOUNT_REVISION`, `INSUFFICIENT_CASH`,
   `POSITION_LIMIT`, `INSUFFICIENT_POSITION`). Both kinds of entry rejection
   start the cooldown.
4. **Closed-trade `exit_reason` (flagged).** The originating exit intent's
   reason (`PROFIT_TARGET`, `LOSS_THRESHOLD`, `TIME_EXIT`, `MANUAL_CLOSE`) is
   recorded, even when the filling order came from an `EXIT_RETRY`
   proposal. Retries remain visible on the proposals.
5. **Exits are evaluated on the fill quote too.** Per the required event
   order, the strategy runs after fills on the same event, so a position
   opened by quote *n* can trigger its exit rule on quote *n*. The resulting
   closing order still cannot fill on quote *n*.
6. **Exit intent.** Created once, by the first triggered rule or a user close
   request. It is persisted in `exit_intents`, survives cancellation,
   expiration, and restart, and is resolved only by the closing fill. While
   a closing order is `PENDING`/`OPEN`, no closing proposal is made. Later
   proposals for the same intent use `EXIT_RETRY` and the current bid as the
   limit. A bid of 0 (a sell limit must be positive) or a stale quote defers
   the proposal to the next valid quote.
7. **Manual close.** `request-close` records a `MANUAL_CLOSE` intent. If the
   latest accepted quote for the contract is current (≤ 2 s old on the
   simulated clock), the proposal is made immediately from it; otherwise on
   the next valid quote. Canceling a closing order does not cancel the
   intent.
8. **Contract selection** uses the fixture's contracts. The selected
   contract must have its own current accepted quote; the entry underlying
   price comes from the event quote.
9. **Expiration timing.** `expires_at = submitted_at + 60 s`. At each event,
   orders with `expires_at <= event time` expire before the quote is
   processed; their `updated_at` is the effective expiry time, even when the
   fixture jumps forward. `fill_price` independently refuses fills at or
   after `expires_at`.
10. **Session end.** At `SESSION_CLOSE` remaining `OPEN` orders expire with
    reason `SESSION_END` and release their reservations. After the last event
    the run is `COMPLETED` if flat, else `INCOMPLETE` with the open exposure
    recorded; the position keeps its last bid mark labeled `STALE`. No fill
    or realized P&L is invented.
11. **Run lifecycle.** Runs are either trading-enabled (new flag, fixed at
    creation) or replay-only (all Step 3/4 runs; they never leave `READY`).
    Trading runs go `READY → RUNNING` via `start` (fixture loaded, books
    reconciled), `RUNNING ↔ PAUSED` via pause/resume, and `RUNNING →
    COMPLETED/INCOMPLETE` at the end. The database enforces these transitions.
12. **Reconciliation and recovery.** Trading runs reconcile before every event
    and inside every event's transaction before commit, and the server
    reconciles every `RUNNING` trading run at startup.
    - A failure before an event pauses the run (reason recorded,
      `RECONCILIATION_FAILED` event).
    - An event whose result would not reconcile is rolled back entirely, and
      the run is paused.
    - Resume is refused until the books reconcile.
    - Reconciliation covers: the ledger chain; each fill ↔ its ledger entry;
      one fill per `FILLED` order; open-order reservations equal to
      limit × multiplier × qty + fee (buys) or qty (sells); position reserved
      contracts equal to open closing orders; position cost basis equal to
      entry premium + fee; closed trades equal to their fills; and equity =
      starting cash + realized + unrealized.
13. **Execution guards in the database.** A fill must come from a quote after
    the order's generating quote, not observed before submission, for the
    same contract and run, for the full order quantity, and within displayed
    size not already consumed by earlier fills on that quote. Its price must
    be the ask ≤ limit (buy) or the bid ≥ limit (sell). Proposals and risk
    decisions are immutable; order terms and position entry facts cannot
    change; closed positions are final.
14. **Proposal idempotency key.** `<run>:<intent>:after-event-<n>`, where n is
    the last committed run event. It is deterministic and unique, since at
    most one proposal is made per committed event. Order keys are
    `<run>:order:<proposal>`, so resubmitting a proposal returns the original
    order.
15. **Display of corrupted records.** If stored rows no longer satisfy the
    record invariants, the dashboard still renders them as stored, with
    reconciliation marked `FAILED`, instead of failing the page.
16. **Reconciliation blocks every trading mutation (Step 5 review).** On a
    trading run, step, replay-to-end (before every event), start, resume,
    request-close, and cancel all reconcile first. Order acceptance
    reconciles again inside the event's transaction before the broker sees
    the order, and start, request-close, and cancel reconcile again before
    commit.
    - On failure, nothing is changed and the command is refused
      (`RECONCILIATION_FAILED`, HTTP 409).
    - A `RUNNING` run is paused with the reason and one
      `RECONCILIATION_FAILED` event. Refusals on an already-paused or `READY`
      run write nothing.
    - This also applies to idempotent retries of completed commands.
    - Pause remains allowed, and all reads and diagnostics remain available.
      `/api/account` reports `"trusted": false`.
    - Replay-only runs have no trading books and are not guarded.
17. **Untrusted display fallback.** Authoritative reads (`queries.list_*`,
    the strategy, risk, broker, and accounting modules) validate stored
    records strictly and raise on invalid data. Only display reads
    (`queries.display_*`, used by the dashboard, the positions/orders/
    closed-trades endpoints, and `trades`) show invalid rows. Each such row
    is flagged `untrusted: true` with its validation error. When
    reconciliation fails, the dashboard shows an UNTRUSTED banner and
    labels, and disables commands. A test enforces that trading code never
    imports the display reads.
18. **Valuation and account revision.** `mark_positions` and
    `refresh_staleness` never increment the revision. This is valid for
    `risk_v1` because acceptance rechecks only available cash (cash −
    reserved) and unreserved contracts, neither of which depends on marks,
    equity, or valuation status. The proposal's quote is pinned by id, and
    approval and acceptance share one transaction. A future policy that uses
    equity or marks must revisit this rule (see `accounting/revision.py`).
19. **Step 6 verification findings** (details in `STEP6_VALIDATION.md`). No
    trading or accounting rule changed.
    - F1: reconciliation now also requires an open position's market value to
      equal its mark bid × multiplier × quantity, with the mark being the
      contract's latest accepted quote. The equity identity alone could not
      detect a wrong valuation.
    - F2: the dashboard retries a command with the same idempotency key after
      a 5xx response, as it already did after a network error, so a response
      lost after commit is not repeated as a new command.
    - F3: the latest-quote display lists contracts most recent first.
