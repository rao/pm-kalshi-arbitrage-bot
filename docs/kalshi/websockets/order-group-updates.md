Websockets
Order Group Updates
Messages
Order Group Updates

`{  "type": "order_group_updates",  "sid": 21,  "seq": 7,  "msg": {    "event_type": "limit_updated",    "order_group_id": "og_123",    "contracts_limit_fp": "150.00"  }}`

Websockets

Real-time order group lifecycle and limit updates. Requires authentication.

**Requirements:**

*   Authentication required
*   Market specification ignored
*   Updates sent when order groups are created, triggered, reset, deleted, or have limits updated

**Use case:** Tracking order group lifecycle and limits

WSS

wss://api.elections.kalshi.com

order_group_updates

Messages

Order Group Updates

`{  "type": "order_group_updates",  "sid": 21,  "seq": 7,  "msg": {    "event_type": "limit_updated",    "order_group_id": "og_123",    "contracts_limit_fp": "150.00"  }}`