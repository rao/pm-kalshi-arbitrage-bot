Create RFQ
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/rfqs \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "market_ticker": "<string>",
}
'
```

201

500

```
{
  "id": "<string>"
}
```

communications

Endpoint for creating a new RFQ. You can have a maximum of 100 open RFQs at a time.

POST

/

communications

/

rfqs

Create RFQ

{
  "market_ticker": "<string>",
}
'
```

  "id": "<string>"
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

market_ticker

string

required

The ticker of the market for which to create an RFQ

rest_remainder

boolean

required

Whether to rest the remainder of the RFQ after execution

contracts

integer

The number of contracts for the RFQ. Whole contracts only. Contracts may be provided via contracts or contracts_fp; if both provided they must match.

contracts_fp

string | null

String representation of the number of contracts for the RFQ (whole contracts only). Contracts may be provided via contracts or contracts_fp; if both provided they must match.

Example:

`"10.00"`

target_cost_centi_cents

integer<int64>

deprecated

DEPRECATED: The target cost for the RFQ in centi-cents. Use target_cost_dollars instead.

target_cost_dollars

string

The target cost for the RFQ in dollars

Example:

`"0.5600"`

replace_existing

boolean

default:false

Whether to delete existing RFQs as part of this RFQ's creation

subtrader_id

string

The subtrader to create the RFQ for (FCM members only)

#### Response

application/json

RFQ created successfully

id

string

required

The ID of the newly created RFQ