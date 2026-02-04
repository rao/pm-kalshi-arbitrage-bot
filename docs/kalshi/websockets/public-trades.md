Websockets
Public Trades
Messages
Trade Update

`{  "type": "trade",  "sid": 11,  "msg": {    "trade_id": "d91bc706-ee49-470d-82d8-11418bda6fed",    "market_ticker": "HIGHNY-22DEC23-B53.5",    "yes_price": 36,    "yes_price_dollars": "0.360",    "no_price": 64,    "no_price_dollars": "0.640",    "count": 136,    "count_fp": "136.00",    "taker_side": "no",    "ts": 1669149841  }}`

Websockets

Public trade notifications when trades occur.

**Requirements:**

*   Market specification optional (omit to receive all trades)
*   Updates sent immediately after trade execution

**Use case:** Trade feed, volume analysis

WSS

wss://api.elections.kalshi.com

trade

Messages

Trade Update

`{  "type": "trade",  "sid": 11,  "msg": {    "trade_id": "d91bc706-ee49-470d-82d8-11418bda6fed",    "market_ticker": "HIGHNY-22DEC23-B53.5",    "yes_price": 36,    "yes_price_dollars": "0.360",    "no_price": 64,    "no_price_dollars": "0.640",    "count": 136,    "count_fp": "136.00",    "taker_side": "no",    "ts": 1669149841  }}`