Amend Order
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/orders/{order_id}/amend \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "ticker": "<string>",
}
'
```

200

500

```
{
  "old_order": {
    "order_id": "<string>",
  }
```

orders

Endpoint for amending the max number of fillable contracts and/or price in an existing order. Max fillable contracts is `remaining_count` + `fill_count`.

POST

/

portfolio

/

orders

/

{order_id}

/

amend

Amend Order

{
  "ticker": "<string>",
}
'
```

  "old_order": {
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

ticker

string

required

Market ticker

side

enum<string>

required

Side of the order

Available options:

`yes`,

`no`

action

enum<string>

required

Action of the order

Available options:

`buy`,

`sell`

subaccount

integer

default:0

Optional subaccount number to use for this amendment (0 for primary, 1-32 for subaccounts)

Required range: `x >= 0`

client_order_id

string

The original client-specified order ID to be amended

updated_client_order_id

string

The new client-specified order ID after amendment

yes_price

integer

Updated yes price for the order in cents

Required range: `1 <= x <= 99`

no_price

integer

Updated no price for the order in cents

Required range: `1 <= x <= 99`

yes_price_dollars

string

Updated yes price for the order in fixed-point dollars. Exactly one of yes_price, no_price, yes_price_dollars, and no_price_dollars must be passed.

Example:

`"0.5600"`

no_price_dollars

string

Updated no price for the order in fixed-point dollars. Exactly one of yes_price, no_price, yes_price_dollars, and no_price_dollars must be passed.

Example:

`"0.5600"`

count

integer

Updated quantity for the order (whole contracts only). If updating quantity, provide count or count_fp; if both provided they must match.

Required range: `x >= 1`

count_fp

string | null

String representation of the updated quantity for the order (whole contracts only). If updating quantity, provide count or count_fp; if both provided they must match.

Example:

`"10.00"`

#### Response

application/json

Order amended successfully

old_order

object

required

The order before amendment

Show child attributes

order

object

required

The order after amendment

Show child attributes