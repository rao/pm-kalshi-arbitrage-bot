Get Series List
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/series
```

200

500

```
{
  "series": [
    {
      "ticker": "<string>",
        }
      ],
    }
  ]
}
```

market

Endpoint for getting data about multiple series with specified filters. A series represents a template for recurring events that follow the same format and rules (e.g., “Monthly Jobs Report”, “Weekly Initial Jobless Claims”, “Daily Weather in NYC”). This endpoint allows you to browse and discover available series templates by category.

GET

/

series

Get Series List

        }
      ],
    }
  ]
}
```

#### Query Parameters

category

string

tags

string

include_product_metadata

boolean

default:false

include_volume

boolean

default:false

If true, includes the total volume traded across all events in each series.

#### Response

application/json

Series list retrieved successfully

series

object[]

required

Show child attributes