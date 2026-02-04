Create Order Group
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/order_groups/create \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "subaccount": 0,
}
'
```

201

500

```
{
  "order_group_id": "<string>"
}
```

order-groups

Creates a new order group with a contracts limit measured over a rolling 15-second window. When the limit is hit, all orders in the group are cancelled and no new orders can be placed until reset.

POST

/

portfolio

/

order_groups

/

create

Create Order Group

{
  "subaccount": 0,
}
'
```

  "order_group_id": "<string>"
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

#### Body

application/json

subaccount

integer

default:0

Optional subaccount number to use for this order group (0 for primary, 1-32 for subaccounts)

Required range: `x >= 0`

contracts_limit

integer<int64>

Specifies the maximum number of contracts that can be matched within this group over a rolling 15-second window. Whole contracts only. Provide contracts_limit or contracts_limit_fp; if both provided they must match.

Required range: `x >= 1`

contracts_limit_fp

string | null

String representation of the maximum number of contracts that can be matched within this group over a rolling 15-second window (whole contracts only). Provide contracts_limit or contracts_limit_fp; if both provided they must match.

Example:

`"10.00"`

#### Response

application/json

Order group created successfully

order_group_id

string

required

The unique identifier for the created order group