Get Multivariate Event Collection
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/multivariate_event_collections/{collection_ticker}
```

200

500

```
{
  "multivariate_contract": {
    "collection_ticker": "<string>",
      }
    ],
  }
```

multivariate

Endpoint for getting data about a multivariate event collection by its ticker.

GET

/

multivariate_event_collections

/

{collection_ticker}

Get Multivariate Event Collection

      }
    ],
  }
```

#### Path Parameters

collection_ticker

string

required

Collection ticker

#### Response

application/json

Collection retrieved successfully

multivariate_contract

object

required

The multivariate event collection.

Show child attributes