Get Multivariate Event Collection Lookup History
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/multivariate_event_collections/{collection_ticker}/lookup
```

200

500

```
{
  "lookup_points": [
    {
      "event_ticker": "<string>",
        }
      ],
    }
  ]
}
```

multivariate

Endpoint for retrieving which markets in an event collection were recently looked up.

GET

/

multivariate_event_collections

/

{collection_ticker}

/

lookup

Get Multivariate Event Collection Lookup History

        }
      ],
    }
  ]
}
```

#### Path Parameters

collection_ticker

string

required

Collection ticker

#### Query Parameters

lookback_seconds

enum<integer>

required

Number of seconds to look back for lookup history. Must be one of 10, 60, 300, or 3600.

Available options:

`10`,

`60`,

`300`,

`3600`

#### Response

application/json

Lookup history retrieved successfully

lookup_points

object[]

required

List of recent lookup points in the collection.

Show child attributes