Get Event Metadata
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/events/{event_ticker}/metadata
```

200

```
{
  "image_url": "<string>",
    }
  ],
    }
  ],
}
```

events

Endpoint for getting metadata about an event by its ticker. Returns only the metadata information for an event.

GET

/

events

/

{event_ticker}

/

metadata

Get Event Metadata

    }
  ],
    }
  ],
}
```

#### Path Parameters

event_ticker

string

required

Event ticker

#### Response

200

application/json

Event metadata retrieved successfully

image_url

string

required

A path to an image that represents this event.

market_details

object[]

required

Metadata for the markets in this event.

Show child attributes

settlement_sources

object[]

required

A list of settlement sources for this event.

Show child attributes

featured_image_url

string

A path to an image that represents the image of the featured market.

competition

string | null

Event competition.

competition_scope

string | null

Event scope, based on the competition.