Get Multivariate Events
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/events/multivariate
```

200

```
{
  "events": [
    {
      "event_ticker": "<string>",
            }
          ],
            }
          ],
        }
      ]
    }
  ],
}
```

events

Retrieve multivariate (combo) events. These are dynamically created events from multivariate event collections. Supports filtering by series and collection ticker.

GET

/

events

/

multivariate

Get Multivariate Events

            }
          ],
            }
          ],
        }
      ]
    }
  ],
}
```

#### Query Parameters

limit

integer

default:100

Number of results per page. Defaults to 100. Maximum value is 200.

Required range: `1 <= x <= 200`

cursor

string

Pagination cursor. Use the cursor value returned from the previous response to get the next page of results.

series_ticker

string

Filter by series ticker

collection_ticker

string

Filter events by collection ticker. Returns only multivariate events belonging to the specified collection. Cannot be used together with series_ticker.

with_nested_markets

boolean

default:false

Parameter to specify if nested markets should be included in the response. When true, each event will include a 'markets' field containing a list of Market objects associated with that event.

#### Response

200

application/json

Multivariate events retrieved successfully

events

object[]

required

Array of multivariate events matching the query criteria.

Show child attributes

cursor

string

required

Pagination cursor for the next page. Empty if there are no more results.