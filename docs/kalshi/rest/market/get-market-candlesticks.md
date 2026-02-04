Get Market Candlesticks
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/series/{series_ticker}/markets/{ticker}/candlesticks
```

200

```
{
  "ticker": "<string>",
    }
  ]
}
```

market

Time period length of each candlestick in minutes. Valid values: 1 (1 minute), 60 (1 hour), 1440 (1 day).

GET

/

series

/

{series_ticker}

/

markets

/

{ticker}

/

candlesticks

Get Market Candlesticks

    }
  ]
}
```

#### Path Parameters

series_ticker

string

required

Series ticker - the series that contains the target market

ticker

string

required

Market ticker - unique identifier for the specific market

#### Query Parameters

start_ts

integer<int64>

required

Start timestamp (Unix timestamp). Candlesticks will include those ending on or after this time.

end_ts

integer<int64>

required

End timestamp (Unix timestamp). Candlesticks will include those ending on or before this time.

period_interval

enum<integer>

required

Time period length of each candlestick in minutes. Valid values are 1 (1 minute), 60 (1 hour), or 1440 (1 day).

Available options:

`1`,

`60`,

`1440`

include_latest_before_start

boolean

default:false

If true, prepends the latest candlestick available before the start_ts. This synthetic candlestick is created by:

1.   Finding the most recent real candlestick before start_ts
2.   Projecting it forward to the first period boundary (calculated as the next period interval after start_ts)
3.   Setting all OHLC prices to null, and `previous_price` to the close price from the real candlestick

#### Response

200

application/json

Candlesticks retrieved successfully

ticker

string

required

Unique identifier for the market.

candlesticks

object[]

required

Array of candlestick data points for the specified time range.

Show child attributes