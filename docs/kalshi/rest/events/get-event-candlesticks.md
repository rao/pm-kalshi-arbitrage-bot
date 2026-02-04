Get Event Candlesticks
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/series/{series_ticker}/events/{ticker}/candlesticks
```

200

```
{
  "market_tickers": [
    "<string>"
  ],
      }
    ]
  ],
}
```

events

End-point for returning aggregated data across all markets corresponding to an event.

GET

/

series

/

{series_ticker}

/

events

/

{ticker}

/

candlesticks

Get Event Candlesticks

      }
    ]
  ],
}
```

#### Path Parameters

ticker

string

required

The event ticker

series_ticker

string

required

The series ticker

#### Query Parameters

start_ts

integer<int64>

required

Start timestamp for the range

end_ts

integer<int64>

required

End timestamp for the range

period_interval

enum<integer>

required

Specifies the length of each candlestick period, in minutes. Must be one minute, one hour, or one day.

Available options:

`1`,

`60`,

`1440`

#### Response

200

application/json

Event candlesticks retrieved successfully

market_tickers

string[]

required

Array of market tickers in the event.

market_candlesticks

object[][]

required

Array of market candlestick arrays, one for each market in the event.

Show child attributes

adjusted_end_ts

integer<int64>

required

Adjusted end timestamp if the requested candlesticks would be larger than maxAggregateCandidates.