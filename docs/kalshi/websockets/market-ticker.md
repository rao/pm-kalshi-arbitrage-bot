Websockets
Market Ticker
Messages
Ticker Update

`{  "type": "ticker",  "sid": 11,  "msg": {    "market_ticker": "FED-23DEC-T3.00",    "market_id": "9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1",    "price": 48,    "yes_bid": 45,    "yes_ask": 53,    "price_dollars": "0.480",    "yes_bid_dollars": "0.450",    "yes_ask_dollars": "0.530",    "volume": 33896,    "volume_fp": "33896.00",    "open_interest": 20422,    "open_interest_fp": "20422.00",    "dollar_volume": 16948,    "dollar_open_interest": 10211,    "ts": 1669149841  }}`

Websockets

Market price, volume, and open interest updates.

**Requirements:**

*   Market specification optional (omit to receive all markets)
*   Supports `market_ticker`/`market_tickers` and `market_id`/`market_ids`
*   Updates sent whenever any ticker field changes

**Use case:** Displaying current market prices and statistics

WSS

wss://api.elections.kalshi.com

ticker

Messages

Ticker Update

`{  "type": "ticker",  "sid": 11,  "msg": {    "market_ticker": "FED-23DEC-T3.00",    "market_id": "9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1",    "price": 48,    "yes_bid": 45,    "yes_ask": 53,    "price_dollars": "0.480",    "yes_bid_dollars": "0.450",    "yes_ask_dollars": "0.530",    "volume": 33896,    "volume_fp": "33896.00",    "open_interest": 20422,    "open_interest_fp": "20422.00",    "dollar_volume": 16948,    "dollar_open_interest": 10211,    "ts": 1669149841  }}`