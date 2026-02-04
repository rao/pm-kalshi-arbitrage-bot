Get Series
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/series/{series_ticker}
```

200

500

```
{
  "series": {
    "ticker": "<string>",
      }
    ],
  }
```

market

Endpoint for getting data about a specific series by its ticker. A series represents a template for recurring events that follow the same format and rules (e.g., “Monthly Jobs Report”, “Weekly Initial Jobless Claims”, “Daily Weather in NYC”). Series define the structure, settlement sources, and metadata that will be applied to each recurring event instance within that series.

GET

/

series

/

{series_ticker}

Get Series

      }
    ],
  }
```

#### Path Parameters

series_ticker

string

required

The ticker of the series to retrieve

#### Query Parameters

include_volume

boolean

default:false

If true, includes the total volume traded across all events in this series.

#### Response

application/json

Series retrieved successfully

series

object

required

Show child attributes