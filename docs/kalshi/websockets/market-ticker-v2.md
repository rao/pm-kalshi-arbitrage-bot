Websockets
Market Ticker V2
Messages
Ticker V2 Update

`{  "type": "ticker_v2",  "sid": 11,  "msg": {    "market_ticker": "FED-23DEC-T3.00",    "market_id": "9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1",    "price": 48,    "price_dollars": "0.480",    "volume_delta": 100,    "volume_delta_fp": "100.00",    "open_interest_delta": 10,    "open_interest_delta_fp": "10.00",    "dollar_volume_delta": 50,    "dollar_open_interest_delta": 5,    "ts": 1669149841  }}`

Websockets

Incremental ticker updates with delta fields. Messages may contain a subset of fields depending on which summary triggered the update.

**Requirements:**

*   Market specification optional (omit to receive all markets)
*   Supports `market_ticker`/`market_tickers` and `market_id`/`market_ids`

**Use case:** Streaming lightweight ticker deltas and combining with your cached state

WSS

wss://api.elections.kalshi.com

ticker_v2

Messages

Ticker V2 Update

`{  "type": "ticker_v2",  "sid": 11,  "msg": {    "market_ticker": "FED-23DEC-T3.00",    "market_id": "9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1",    "price": 48,    "price_dollars": "0.480",    "volume_delta": 100,    "volume_delta_fp": "100.00",    "open_interest_delta": 10,    "open_interest_delta_fp": "10.00",    "dollar_volume_delta": 50,    "dollar_open_interest_delta": 5,    "ts": 1669149841  }}`