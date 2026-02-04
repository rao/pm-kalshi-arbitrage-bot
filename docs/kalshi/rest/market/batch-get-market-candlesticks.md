Batch Get Market Candlesticks
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/markets/candlesticks
```

200

```
{
  "markets": [
    {
      "market_ticker": "<string>",
        }
      ]
    }
  ]
}
```

market

Endpoint for retrieving candlestick data for multiple markets.

*   Accepts up to 100 market tickers per request
*   Returns up to 10,000 candlesticks total across all markets
*   Returns candlesticks grouped by market_id
*   Optionally includes a synthetic initial candlestick for price continuity (see `include_latest_before_start` parameter)

GET

/

markets

/

candlesticks

Batch Get Market Candlesticks

        }
      ]
    }
  ]
}
```

#### Query Parameters

market_tickers

string

required

Comma-separated list of market tickers (maximum 100)

start_ts

integer<int64>

required

Start timestamp in Unix seconds

end_ts

integer<int64>

required

End timestamp in Unix seconds

period_interval

integer<int32>

required

Candlestick period interval in minutes

Required range: `x >= 1`

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

Market candlesticks retrieved successfully

markets

object[]

required

Array of market candlestick data, one entry per requested market.

Show child attributes