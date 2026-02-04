Create Order
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/orders \
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

201

500

```
{
  "order": {
    "order_id": "<string>",
  }
```

orders

Endpoint for submitting orders in a market. Each user is limited to 200 000 open orders at a time.

POST

/

portfolio

/

orders

Create Order

{
  "ticker": "<string>",
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

#### Body

application/json

ticker

string

required

side

enum<string>

required

Available options:

`yes`,

`no`

action

enum<string>

required

Available options:

`buy`,

`sell`

client_order_id

string

count

integer

Order quantity in contracts (whole contracts only). Provide count or count_fp; if both provided they must match.

Required range: `x >= 1`

count_fp

string | null

String representation of the order quantity in contracts (whole contracts only). Provide count or count_fp; if both provided they must match.

Example:

`"10.00"`

type

enum<string>

Available options:

`limit`,

`market`

yes_price

integer

Required range: `1 <= x <= 99`

no_price

integer

Required range: `1 <= x <= 99`

yes_price_dollars

string

Submitting price of the Yes side in fixed-point dollars

Example:

`"0.5600"`

no_price_dollars

string

Submitting price of the No side in fixed-point dollars

Example:

`"0.5600"`

expiration_ts

integer<int64>

time_in_force

enum<string>

Available options:

`fill_or_kill`,

`good_till_canceled`,

`immediate_or_cancel`

buy_max_cost

integer

Maximum cost in cents. When specified, the order will automatically have Fill-or-Kill (FoK) behavior.

post_only

boolean

reduce_only

boolean

sell_position_floor

integer

Deprecated: Use reduce_only instead. Only accepts value of 0.

self_trade_prevention_type

enum<string>

The self-trade prevention type for orders

Available options:

`taker_at_cross`,

`maker`

order_group_id

string

The order group this order is part of

cancel_order_on_pause

boolean

If this flag is set to true, the order will be canceled if the order is open and trading on the exchange is paused for any reason.

subaccount

integer

default:0

The subaccount number to use for this order. 0 is the primary subaccount.

Required range: `x >= 0`

#### Response

application/json

Order created successfully

order

object

required

Show child attributes