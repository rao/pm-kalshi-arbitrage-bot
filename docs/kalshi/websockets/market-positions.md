Websockets
Market Positions
Messages
Market Position Update

`{  "type": "market_position",  "sid": 14,  "msg": {    "user_id": "user123",    "market_ticker": "FED-23DEC-T3.00",    "position": 100,    "position_fp": "100.00",    "position_cost": 500000,    "realized_pnl": 100000,    "fees_paid": 10000,    "position_fee_cost": 5000,    "volume": 15,    "volume_fp": "15.00"  }}`

Websockets

Real-time updates of your positions in markets. Requires authentication.

**Requirements:**

*   Authentication required
*   Market specification optional (omit to receive all positions)
*   Filters are by `market_ticker`/`market_tickers` only; `market_id`/`market_ids` are not supported
*   Updates sent when your position changes due to trades, settlements, etc.

**Monetary Values:** All monetary values (position_cost, realized_pnl, fees_paid) are returned in centi-cents (1/10,000th of a dollar). To convert to dollars, divide by 10,000.

**Use case:** Portfolio tracking, position monitoring, P&L calculations

WSS

wss://api.elections.kalshi.com

market_positions

Messages

Market Position Update

`{  "type": "market_position",  "sid": 14,  "msg": {    "user_id": "user123",    "market_ticker": "FED-23DEC-T3.00",    "position": 100,    "position_fp": "100.00",    "position_cost": 500000,    "realized_pnl": 100000,    "fees_paid": 10000,    "position_fee_cost": 5000,    "volume": 15,    "volume_fp": "15.00"  }}`