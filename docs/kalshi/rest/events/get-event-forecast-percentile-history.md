Get Event Forecast Percentile History
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/series/{series_ticker}/events/{ticker}/forecast_percentile_history \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

```
{
  "forecast_history": [
    {
      "event_ticker": "<string>",
        }
      ]
    }
  ]
}
```

events

Endpoint for getting the historical raw and formatted forecast numbers for an event at specific percentiles.

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

forecast_percentile_history

Get Event Forecast Percentile History

        }
      ]
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

percentiles

integer<int32>[]

required

Array of percentile values to retrieve (0-10000, max 10 values)

Maximum array length: `10`

Required range: `0 <= x <= 10000`

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

Specifies the length of each forecast period, in minutes. 0 for 5-second intervals, or 1, 60, or 1440 for minute-based intervals.

Available options:

`0`,

`1`,

`60`,

`1440`

#### Response

200

application/json

Event forecast percentile history retrieved successfully

forecast_history

object[]

required

Array of forecast percentile data points over time.

Show child attributes