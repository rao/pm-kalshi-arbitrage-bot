Delete Order Group
cURL

```
curl --request DELETE \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/order_groups/{order_group_id} \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

`{}`

order-groups

Deletes an order group and cancels all orders within it. This permanently removes the group.

DELETE

/

portfolio

/

order_groups

/

{order_group_id}

Delete Order Group

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

#### Response

application/json

Order group deleted successfully

An empty response body