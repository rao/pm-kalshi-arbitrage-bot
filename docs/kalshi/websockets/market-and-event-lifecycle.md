Websockets
Market & Event Lifecycle
Messages
Market Lifecycle V2

`{  "type": "market_lifecycle_v2",  "sid": 13,  "msg": {    "market_ticker": "INXD-23SEP14-B4487",    "event_type": "created",    "open_ts": 1694635200,    "close_ts": 1694721600,    "additional_metadata": {      "name": "S&P 500 daily return on Sep 14",      "title": "S&P 500 closes up by 0.02% or more",      "yes_sub_title": "S&P 500 closes up 0.02%+",      "no_sub_title": "S&P 500 closes up <0.02%",      "rules_primary": "The S&P 500 index level at 4:00 PM ET...",      "rules_secondary": "",      "can_close_early": true,      "event_ticker": "INXD-23SEP14",      "expected_expiration_ts": 1694721600,      "strike_type": "greater",      "floor_strike": 4487    }  }}`

Event Lifecycle

`{  "type": "event_lifecycle",  "sid": 5,  "msg": {    "event_ticker": "KXQUICKSETTLE-26JAN25H2150",    "title": "What will 1+1 equal on Jan 25 at 21:50?",    "subtitle": "Jan 25 at 21:50",    "collateral_return_type": "MECNET",    "series_ticker": "KXQUICKSETTLE"  }}`

Websockets

Market state changes and event creation notifications.

**Requirements:**

*   Receives all market and event lifecycle notifications (`market_ticker` filters are not supported)
*   Event creation notifications

**Use case:** Tracking market lifecycle including creation, de(activation), close date changes, determination, settlement

WSS

wss://api.elections.kalshi.com

market_lifecycle_v2

Messages

Market Lifecycle V2

`{  "type": "market_lifecycle_v2",  "sid": 13,  "msg": {    "market_ticker": "INXD-23SEP14-B4487",    "event_type": "created",    "open_ts": 1694635200,    "close_ts": 1694721600,    "additional_metadata": {      "name": "S&P 500 daily return on Sep 14",      "title": "S&P 500 closes up by 0.02% or more",      "yes_sub_title": "S&P 500 closes up 0.02%+",      "no_sub_title": "S&P 500 closes up <0.02%",      "rules_primary": "The S&P 500 index level at 4:00 PM ET...",      "rules_secondary": "",      "can_close_early": true,      "event_ticker": "INXD-23SEP14",      "expected_expiration_ts": 1694721600,      "strike_type": "greater",      "floor_strike": 4487    }  }}`

Event Lifecycle

`{  "type": "event_lifecycle",  "sid": 5,  "msg": {    "event_ticker": "KXQUICKSETTLE-26JAN25H2150",    "title": "What will 1+1 equal on Jan 25 at 21:50?",    "subtitle": "Jan 25 at 21:50",    "collateral_return_type": "MECNET",    "series_ticker": "KXQUICKSETTLE"  }}`