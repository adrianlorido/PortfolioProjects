"""Paper broker boundary (not implemented; arrives in Step 5).

Execution model ``next_quote_touch_v1``: limit orders, buy at ask / sell at
bid on the *next* eligible quote, all-or-none against displayed size, 60-second
simulated TTL. Order lifecycle transitions are already enforced by database
triggers (see storage/migrations/0001_initial.sql).

Order acceptance (SPEC.md clarification 6) must, inside one BEGIN IMMEDIATE
transaction: recheck the risk decision's ``account_revision`` against the
account, revalidate available cash (buys) or unreserved contracts (sells),
insert the order with its reservation, and increment ``account_revision``.
Cancellation, expiration, and fills also increment it in the same
transaction that releases or consumes the reservation.

There is intentionally no live broker adapter and no real-order endpoint.

Planned interface::

    submit(proposal_id, idempotency_key) -> Order
    on_quote(quote_id) -> list[fill candidates]
    cancel(order_id, idempotency_key) -> Order
"""

from paper_trading.broker.interface import PaperBroker  # noqa: F401
