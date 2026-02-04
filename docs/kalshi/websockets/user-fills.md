Websockets
User Fills
Messages
Fill Update

`{  "type": "fill",  "sid": 13,  "msg": {    "trade_id": "d91bc706-ee49-470d-82d8-11418bda6fed",    "order_id": "ee587a1c-8b87-4dcf-b721-9f6f790619fa",    "market_ticker": "HIGHNY-22DEC23-B53.5",    "is_taker": true,    "side": "yes",    "yes_price": 75,    "yes_price_dollars": "0.750",    "count": 278,    "count_fp": "278.00",    "action": "buy",    "ts": 1671899397,    "post_position": 500,    "post_position_fp": "500.00",    "purchased_side": "yes",    "subaccount": 3  }}`

Websockets

Your order fill notifications. Requires authentication.

**Requirements:**

*   Authentication required
*   Market specification ignored (always sends all your fills)
*   Updates sent immediately when your orders are filled

**Use case:** Tracking your trading activity

WSS

wss://api.elections.kalshi.com

fill

Messages

Fill Update

`{  "type": "fill",  "sid": 13,  "msg": {    "trade_id": "d91bc706-ee49-470d-82d8-11418bda6fed",    "order_id": "ee587a1c-8b87-4dcf-b721-9f6f790619fa",    "market_ticker": "HIGHNY-22DEC23-B53.5",    "is_taker": true,    "side": "yes",    "yes_price": 75,    "yes_price_dollars": "0.750",    "count": 278,    "count_fp": "278.00",    "action": "buy",    "ts": 1671899397,    "post_position": 500,    "post_position_fp": "500.00",    "purchased_side": "yes",    "subaccount": 3  }}`