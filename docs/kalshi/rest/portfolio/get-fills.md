Get Fills
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/fills \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

```
{
  "fills": [
    {
      "fill_id": "<string>",
    }
  ],
}
```

portfolio

Endpoint for getting all fills for the member. A fill is when a trade you have is matched.

GET

/

portfolio

/

fills

Get Fills

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

order_id

string

Filter by order ID

min_ts

integer<int64>

Filter items after this Unix timestamp

max_ts

integer<int64>

Filter items before this Unix timestamp

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

200

application/json

Fills retrieved successfully

fills

object[]

required

Show child attributes

cursor

string

required