Get Events
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/events
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
  ]
}
```

events

Get all events. This endpoint excludes multivariate events. To retrieve multivariate events, use the GET /events/multivariate endpoint.

GET

/

events

Get Events

            }
          ],
            }
          ],
        }
      ]
    }
  ],
    }
  ]
}
```

#### Query Parameters

limit

integer

default:200

Parameter to specify the number of results per page. Defaults to 200. Maximum value is 200.

Required range: `1 <= x <= 200`

cursor

string

Parameter to specify the pagination cursor. Use the cursor value returned from the previous response to get the next page of results. Leave empty for the first page.

with_nested_markets

boolean

default:false

Parameter to specify if nested markets should be included in the response. When true, each event will include a 'markets' field containing a list of Market objects associated with that event.

with_milestones

boolean

default:false

If true, includes related milestones as a field alongside events.

status

enum<string>

Filter by event status. Possible values are 'open', 'closed', 'settled'. Leave empty to return events with any status.

Available options:

`open`,

`closed`,

`settled`

series_ticker

string

Filter by series ticker

min_close_ts

integer<int64>

Filter events with at least one market with close timestamp greater than this Unix timestamp (in seconds).

#### Response

200

application/json

Events retrieved successfully

events

object[]

required

Array of events matching the query criteria.

Show child attributes

cursor

string

required

Pagination cursor for the next page. Empty if there are no more results.

milestones

object[]

Array of milestones related to the events.

Show child attributes