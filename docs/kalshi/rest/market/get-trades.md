Get Trades
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/markets/trades
```

200

```
{
  "trades": [
    {
      "trade_id": "<string>",
    }
  ],
}
```

market

Endpoint for getting all trades for all markets. A trade represents a completed transaction between two users on a specific market. Each trade includes the market ticker, price, quantity, and timestamp information. This endpoint returns a paginated response. Use the ‘limit’ parameter to control page size (1-1000, defaults to 100). The response includes a ‘cursor’ field - pass this value in the ‘cursor’ parameter of your next request to get the next page. An empty cursor indicates no more pages are available.

GET

/

markets

/

trades

Get Trades

    }
  ],
}
```

#### Query Parameters

limit

integer<int64>

default:100

Number of results per page. Defaults to 100. Maximum value is 1000.

Required range: `1 <= x <= 1000`

cursor

string

Pagination cursor. Use the cursor value returned from the previous response to get the next page of results. Leave empty for the first page.

ticker

string

Filter by market ticker

min_ts

integer<int64>

Filter items after this Unix timestamp

max_ts

integer<int64>

Filter items before this Unix timestamp

#### Response

200

application/json

Trades retrieved successfully

trades

object[]

required

Show child attributes

cursor

string

required