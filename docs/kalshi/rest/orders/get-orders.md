Get Orders
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/orders \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "orders": [
    {
      "order_id": "<string>",
    }
  ],
}
```

orders

Restricts the response to orders that have a certain status: resting, canceled, or executed.

GET

/

portfolio

/

orders

Get Orders

    }
  ],
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

ticker

string

Filter by market ticker

event_ticker

string

Event ticker of desired positions. Multiple event tickers can be provided as a comma-separated list (maximum 10).

min_ts

integer<int64>

Filter items after this Unix timestamp

max_ts

integer<int64>

Filter items before this Unix timestamp

status

string

Filter by status. Possible values depend on the endpoint.

limit

integer<int64>

default:100

Number of results per page. Defaults to 100. Maximum value is 200.

Required range: `1 <= x <= 200`

cursor

string

Pagination cursor. Use the cursor value returned from the previous response to get the next page of results. Leave empty for the first page.

subaccount

integer

Subaccount number (0 for primary, 1-32 for subaccounts). If omitted, returns results across all subaccounts.

#### Response

application/json

Orders retrieved successfully

orders

object[]

required

Show child attributes

cursor

string

required