Get Positions
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/positions \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "market_positions": [
    {
      "ticker": "<string>",
    }
  ],
    }
  ],
}
```

portfolio

Restricts the positions to those with any of following fields with non-zero values, as a comma separated list. The following values are accepted: position, total_traded

GET

/

portfolio

/

positions

Get Positions

    }
  ],
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

cursor

string

The Cursor represents a pointer to the next page of records in the pagination. Use the value returned from the previous response to get the next page.

limit

integer<int32>

default:100

Parameter to specify the number of results per page. Defaults to 100.

Required range: `1 <= x <= 1000`

count_filter

string

Restricts the positions to those with any of following fields with non-zero values, as a comma separated list. The following values are accepted - position, total_traded

ticker

string

Filter by market ticker

event_ticker

string

Event ticker of desired positions. Multiple event tickers can be provided as a comma-separated list (maximum 10).

subaccount

integer

Subaccount number (0 for primary, 1-32 for subaccounts). If omitted, returns results across all subaccounts.

#### Response

application/json

Positions retrieved successfully

market_positions

object[]

required

List of market positions

Show child attributes

event_positions

object[]

required

List of event positions

Show child attributes

cursor

string

The Cursor represents a pointer to the next page of records in the pagination. Use the value returned here in the cursor query parameter for this end-point to get the next page containing limit records. An empty value of this field indicates there is no next page.