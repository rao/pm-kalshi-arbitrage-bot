Decrease Order
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/orders/{order_id}/decrease \
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

200

500

```
{
  "order": {
    "order_id": "<string>",
  }
```

orders

Endpoint for decreasing the number of contracts in an existing order. This is the only kind of edit available on order quantity. Cancelling an order is equivalent to decreasing an order amount to zero.

POST

/

portfolio

/

orders

/

{order_id}

/

decrease

Decrease Order

{
  "subaccount": 0,
}
'
```

  "order": {
    "order_id": "<string>",
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

order_id

string

required

Order ID

#### Body

application/json

subaccount

integer

default:0

Optional subaccount number to use for this decrease (0 for primary, 1-32 for subaccounts)

Required range: `x >= 0`

reduce_by

integer

Number of contracts to reduce by (whole contracts only). Reduce-by may be provided via reduce_by or reduce_by_fp; if both provided they must match. Exactly one of reduce_by(/reduce_by_fp) or reduce_to(/reduce_to_fp) must be provided.

Required range: `x >= 1`

reduce_by_fp

string | null

String representation of the number of contracts to reduce by (whole contracts only). Reduce-by may be provided via reduce_by or reduce_by_fp; if both provided they must match. Exactly one of reduce_by(/reduce_by_fp) or reduce_to(/reduce_to_fp) must be provided.

Example:

`"10.00"`

reduce_to

integer

Number of contracts to reduce to (whole contracts only). Reduce-to may be provided via reduce_to or reduce_to_fp; if both provided they must match. Exactly one of reduce_by(/reduce_by_fp) or reduce_to(/reduce_to_fp) must be provided.

Required range: `x >= 0`

reduce_to_fp

string | null

String representation of the number of contracts to reduce to (whole contracts only). Reduce-to may be provided via reduce_to or reduce_to_fp; if both provided they must match. Exactly one of reduce_by(/reduce_by_fp) or reduce_to(/reduce_to_fp) must be provided.

Example:

`"10.00"`

#### Response

application/json

Order decreased successfully

order

object

required

Show child attributes