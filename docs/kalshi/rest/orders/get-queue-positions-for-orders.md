Get Queue Positions for Orders
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/orders/queue_positions \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "queue_positions": [
    {
      "order_id": "<string>",
    }
  ]
}
```

orders

Endpoint for getting queue positions for all resting orders. Queue position represents the number of contracts that need to be matched before an order receives a partial or full match, determined using price-time priority.

GET

/

portfolio

/

orders

/

queue_positions

Get Queue Positions for Orders

    }
  ]
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

#### Query Parameters

market_tickers

string

Comma-separated list of market tickers to filter by

event_ticker

string

Event ticker to filter by

subaccount

integer

Subaccount number (0 for primary, 1-32 for subaccounts). If omitted, returns results across all subaccounts.

#### Response

application/json

Queue positions retrieved successfully

queue_positions

object[]

required

Queue positions for all matching orders

Show child attributes