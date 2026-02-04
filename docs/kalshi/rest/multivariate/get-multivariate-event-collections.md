Get Multivariate Event Collections
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/multivariate_event_collections
```

200

500

```
{
  "multivariate_contracts": [
    {
      "collection_ticker": "<string>",
        }
      ],
    }
  ],
}
```

multivariate

Endpoint for getting data about multivariate event collections.

GET

/

multivariate_event_collections

Get Multivariate Event Collections

        }
      ],
    }
  ],
}
```

#### Query Parameters

status

enum<string>

Only return collections of a certain status. Can be unopened, open, or closed.

Available options:

`unopened`,

`open`,

`closed`

associated_event_ticker

string

Only return collections associated with a particular event ticker.

series_ticker

string

Only return collections with a particular series ticker.

limit

integer<int32>

Specify the maximum number of results.

Required range: `1 <= x <= 200`

cursor

string

The Cursor represents a pointer to the next page of records in the pagination. This optional parameter, when filled, should be filled with the cursor string returned in a previous request to this end-point.

#### Response

application/json

Collections retrieved successfully

multivariate_contracts

object[]

required

List of multivariate event collections.

Show child attributes

cursor

string

The Cursor represents a pointer to the next page of records in the pagination. Use the value returned here in the cursor query parameter for this end-point to get the next page containing limit records. An empty value of this field indicates there is no next page.