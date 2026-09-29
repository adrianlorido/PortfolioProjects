"""Storage: SQLite connections, explicit transactions, and versioned migrations.

Owns transactions, uniqueness, referential integrity, and the replay
checkpoint. Other modules receive a connection inside the coordinator's
transaction; they never open their own write transactions.
"""
