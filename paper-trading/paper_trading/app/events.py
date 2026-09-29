"""Per-run audit events. Every state change appends one, in order."""

from __future__ import annotations

import json
import sqlite3

from paper_trading.app.coordinator import new_id, utc_now


def append_run_event(conn: sqlite3.Connection, run_id: str, event_type: str, simulated_at: str,
                     payload: dict) -> int:
    """Insert the next run event and advance the run checkpoint and clock to it."""
    seq = conn.execute(
        "SELECT COALESCE(MAX(event_sequence), 0) + 1 FROM run_events WHERE run_id = ?", (run_id,)
    ).fetchone()[0]
    conn.execute(
        """INSERT INTO run_events (event_id, run_id, event_sequence, event_type, simulated_at, recorded_at,
               payload_json) VALUES (?,?,?,?,?,?,?)""",
        (new_id("evt"), run_id, seq, event_type, simulated_at, utc_now(), json.dumps(payload, sort_keys=True)),
    )
    conn.execute(
        "UPDATE runs SET checkpoint_event_sequence = ?, simulated_clock = ? WHERE run_id = ?",
        (seq, simulated_at, run_id),
    )
    return seq
