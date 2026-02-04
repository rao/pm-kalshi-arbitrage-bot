Websockets
Communications
Messages
RFQ Created

`{  "type": "rfq_created",  "sid": 15,  "msg": {    "id": "rfq_123",    "creator_id": "",    "market_ticker": "FED-23DEC-T3.00",    "event_ticker": "FED-23DEC",    "contracts": 100,    "contracts_fp": "100.00",    "target_cost": 3500,    "target_cost_dollars": "0.35",    "created_ts": "2024-12-01T10:00:00Z"  }}`

RFQ Deleted

`{  "type": "rfq_deleted",  "sid": 15,  "msg": {    "id": "rfq_123",    "creator_id": "comm_abc123",    "market_ticker": "FED-23DEC-T3.00",    "event_ticker": "FED-23DEC",    "contracts": 100,    "contracts_fp": "100.00",    "target_cost": 3500,    "target_cost_dollars": "0.35",    "deleted_ts": "2024-12-01T10:05:00Z"  }}`

Quote Created

`{  "type": "quote_created",  "sid": 15,  "msg": {    "quote_id": "quote_456",    "rfq_id": "rfq_123",    "quote_creator_id": "comm_def456",    "market_ticker": "FED-23DEC-T3.00",    "event_ticker": "FED-23DEC",    "yes_bid": 35,    "no_bid": 65,    "yes_bid_dollars": "0.35",    "no_bid_dollars": "0.65",    "yes_contracts_offered": 100,    "no_contracts_offered": 200,    "yes_contracts_offered_fp": "100.00",    "no_contracts_offered_fp": "200.00",    "rfq_target_cost": 3500,    "rfq_target_cost_dollars": "0.35",    "created_ts": "2024-12-01T10:02:00Z"  }}`

Quote Accepted

`{  "type": "quote_accepted",  "sid": 15,  "msg": {    "quote_id": "quote_456",    "rfq_id": "rfq_123",    "quote_creator_id": "comm_def456",    "market_ticker": "FED-23DEC-T3.00",    "event_ticker": "FED-23DEC",    "yes_bid": 35,    "no_bid": 65,    "yes_bid_dollars": "0.35",    "no_bid_dollars": "0.65",    "accepted_side": "yes",    "contracts_accepted": 50,    "contracts_accepted_fp": "50.00",    "yes_contracts_offered": 100,    "no_contracts_offered": 200,    "yes_contracts_offered_fp": "100.00",    "no_contracts_offered_fp": "200.00",    "rfq_target_cost": 3500,    "rfq_target_cost_dollars": "0.35"  }}`

Quote Executed

`{  "type": "quote_executed",  "sid": 15,  "msg": {    "quote_id": "quote_456",    "rfq_id": "rfq_123",    "quote_creator_id": "a1b2c3d4e5f6...",    "rfq_creator_id": "f6e5d4c3b2a1...",    "order_id": "order_789",    "client_order_id": "my_client_order_123",    "market_ticker": "FED-23DEC-T3.00",    "executed_ts": "2024-12-01T10:05:00Z"  }}`

Websockets

Real-time Request for Quote (RFQ) and quote notifications. Requires authentication. **Requirements:** - Authentication required - Market specification ignored - Optional sharding for fanout control: - `shard_factor` (1-100) and `shard_key` (0 <= key < shard_factor) - RFQ events (RFQCreated, RFQDeleted) always sent - Quote events (QuoteCreated, QuoteAccepted, QuoteExecuted) are only sent if you created the quote OR you created the RFQ **Use case:** Tracking RFQs you create and quotes on your RFQs, or quotes you create on others' RFQs. Use QuoteExecuted to correlate fill messages with quotes via client_order_id.

WSS

wss://api.elections.kalshi.com

communications

Messages

RFQ Created

`{  "type": "rfq_created",  "sid": 15,  "msg": {    "id": "rfq_123",    "creator_id": "",    "market_ticker": "FED-23DEC-T3.00",    "event_ticker": "FED-23DEC",    "contracts": 100,    "contracts_fp": "100.00",    "target_cost": 3500,    "target_cost_dollars": "0.35",    "created_ts": "2024-12-01T10:00:00Z"  }}`

RFQ Deleted

`{  "type": "rfq_deleted",  "sid": 15,  "msg": {    "id": "rfq_123",    "creator_id": "comm_abc123",    "market_ticker": "FED-23DEC-T3.00",    "event_ticker": "FED-23DEC",    "contracts": 100,    "contracts_fp": "100.00",    "target_cost": 3500,    "target_cost_dollars": "0.35",    "deleted_ts": "2024-12-01T10:05:00Z"  }}`

Quote Created

`{  "type": "quote_created",  "sid": 15,  "msg": {    "quote_id": "quote_456",    "rfq_id": "rfq_123",    "quote_creator_id": "comm_def456",    "market_ticker": "FED-23DEC-T3.00",    "event_ticker": "FED-23DEC",    "yes_bid": 35,    "no_bid": 65,    "yes_bid_dollars": "0.35",    "no_bid_dollars": "0.65",    "yes_contracts_offered": 100,    "no_contracts_offered": 200,    "yes_contracts_offered_fp": "100.00",    "no_contracts_offered_fp": "200.00",    "rfq_target_cost": 3500,    "rfq_target_cost_dollars": "0.35",    "created_ts": "2024-12-01T10:02:00Z"  }}`

Quote Accepted

`{  "type": "quote_accepted",  "sid": 15,  "msg": {    "quote_id": "quote_456",    "rfq_id": "rfq_123",    "quote_creator_id": "comm_def456",    "market_ticker": "FED-23DEC-T3.00",    "event_ticker": "FED-23DEC",    "yes_bid": 35,    "no_bid": 65,    "yes_bid_dollars": "0.35",    "no_bid_dollars": "0.65",    "accepted_side": "yes",    "contracts_accepted": 50,    "contracts_accepted_fp": "50.00",    "yes_contracts_offered": 100,    "no_contracts_offered": 200,    "yes_contracts_offered_fp": "100.00",    "no_contracts_offered_fp": "200.00",    "rfq_target_cost": 3500,    "rfq_target_cost_dollars": "0.35"  }}`

Quote Executed

`{  "type": "quote_executed",  "sid": 15,  "msg": {    "quote_id": "quote_456",    "rfq_id": "rfq_123",    "quote_creator_id": "a1b2c3d4e5f6...",    "rfq_creator_id": "f6e5d4c3b2a1...",    "order_id": "order_789",    "client_order_id": "my_client_order_123",    "market_ticker": "FED-23DEC-T3.00",    "executed_ts": "2024-12-01T10:05:00Z"  }}`