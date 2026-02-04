Get Order Group
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/order_groups/{order_group_id} \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "is_auto_cancel_enabled": true,
}
```

order-groups

Retrieves details for a single order group including all order IDs and auto-cancel status.

GET

/

portfolio

/

order_groups

/

{order_group_id}

Get Order Group

}
```

#### Authorizations

KALSHI-ACCESS-KEY

string

header

required

Your API key ID

KALSHI-ACCESS-SIGNATURE

string

header

required

RSA-PSS signature of the request

KALSHI-ACCESS-TIMESTAMP

string

header

required

Request timestamp in milliseconds

#### Path Parameters

order_group_id

string

required

Order group ID

#### Response

application/json

Order group retrieved successfully

is_auto_cancel_enabled

boolean

required

Whether auto-cancel is enabled for this order group

orders

string[]

required

List of order IDs that belong to this order group

contracts_limit

integer<int64>

Current maximum contracts allowed over a rolling 15-second window (whole contracts only).

contracts_limit_fp

string

String representation of the current maximum contracts allowed over a rolling 15-second window (whole contracts only).

Example:

`"10.00"`