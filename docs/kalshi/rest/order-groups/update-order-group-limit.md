Update Order Group Limit
cURL

```
curl --request PUT \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/order_groups/{order_group_id}/limit \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "contracts_limit": 2,
}
'
```

200

`{}`

order-groups

Updates the order group contracts limit (rolling 15-second window). If the updated limit would immediately trigger the group, all orders in the group are canceled and the group is triggered.

PUT

/

portfolio

/

order_groups

/

{order_group_id}

/

limit

Update Order Group Limit

{
  "contracts_limit": 2,
}
'
```

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

#### Body

application/json

contracts_limit

integer<int64>

New maximum number of contracts that can be matched within this group over a rolling 15-second window. Whole contracts only. Provide contracts_limit or contracts_limit_fp; if both provided they must match.

Required range: `x >= 1`

contracts_limit_fp

string | null

String representation of the new maximum number of contracts that can be matched within this group over a rolling 15-second window (whole contracts only). Provide contracts_limit or contracts_limit_fp; if both provided they must match.

Example:

`"10.00"`

#### Response

application/json

Order group limit updated successfully

An empty response body