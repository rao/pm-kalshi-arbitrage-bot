Websockets
Orderbook Updates
Messages
Orderbook Snapshot

`{  "type": "orderbook_snapshot",  "sid": 2,  "seq": 2,  "msg": {    "market_ticker": "FED-23DEC-T3.00",    "market_id": "9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1",    "yes": [      [        8,        300      ],      [        22,        333      ]    ],    "yes_dollars": [      [        "0.080",        300      ],      [        "0.220",        333      ]    ],    "yes_dollars_fp": [      [        "0.0800",        "300.00"      ],      [        "0.2200",        "333.00"      ]    ],    "no": [      [        54,        20      ],      [        56,        146      ]    ],    "no_dollars": [      [        "0.540",        20      ],      [        "0.560",        146      ]    ],    "no_dollars_fp": [      [        "0.5400",        "20.00"      ],      [        "0.5600",        "146.00"      ]    ]  }}`

Orderbook Delta

`{  "type": "orderbook_delta",  "sid": 2,  "seq": 3,  "msg": {    "market_ticker": "FED-23DEC-T3.00",    "market_id": "9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1",    "price": 96,    "price_dollars": "0.960",    "delta": -54,    "delta_fp": "-54.00",    "side": "yes",    "ts": "2022-11-22T20:44:01Z"  }}`

Websockets

Real-time orderbook price level changes. Provides incremental updates to maintain a live orderbook.

**Requirements:**

*   Authentication required
*   Market specification required:
    *   Use `market_ticker` (string) for a single market
    *   Use `market_tickers` (array of strings) for multiple markets
    *   `market_id`/`market_ids` are not supported for this channel

*   Sends `orderbook_snapshot` first, then incremental `orderbook_delta` updates

**Use case:** Building and maintaining a real-time orderbook

WSS

wss://api.elections.kalshi.com

orderbook_delta

Messages

Orderbook Snapshot

`{  "type": "orderbook_snapshot",  "sid": 2,  "seq": 2,  "msg": {    "market_ticker": "FED-23DEC-T3.00",    "market_id": "9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1",    "yes": [      [        8,        300      ],      [        22,        333      ]    ],    "yes_dollars": [      [        "0.080",        300      ],      [        "0.220",        333      ]    ],    "yes_dollars_fp": [      [        "0.0800",        "300.00"      ],      [        "0.2200",        "333.00"      ]    ],    "no": [      [        54,        20      ],      [        56,        146      ]    ],    "no_dollars": [      [        "0.540",        20      ],      [        "0.560",        146      ]    ],    "no_dollars_fp": [      [        "0.5400",        "20.00"      ],      [        "0.5600",        "146.00"      ]    ]  }}`

Orderbook Delta

`{  "type": "orderbook_delta",  "sid": 2,  "seq": 3,  "msg": {    "market_ticker": "FED-23DEC-T3.00",    "market_id": "9b0f6b43-5b68-4f9f-9f02-9a2d1b8ac1a1",    "price": 96,    "price_dollars": "0.960",    "delta": -54,    "delta_fp": "-54.00",    "side": "yes",    "ts": "2022-11-22T20:44:01Z"  }}`