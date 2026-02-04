Trigger Order Group
cURL

```
curl --request PUT \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/order_groups/{order_group_id}/trigger \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '{}'
```

200

`{}`

order-groups

Triggers the order group, canceling all orders in the group and preventing new orders until the group is reset.

PUT

/

portfolio

/

order_groups

/

{order_group_id}

/

trigger

Trigger Order Group

`{}`

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

#### Query Parameters

subaccount

integer

Subaccount number (0 for primary, 1-32 for subaccounts). If omitted, returns results across all subaccounts.

#### Body

application/json

An empty response body

#### Response

application/json

Order group triggered successfully

An empty response body