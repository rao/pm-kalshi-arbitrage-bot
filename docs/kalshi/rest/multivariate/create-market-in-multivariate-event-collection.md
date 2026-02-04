Create Market In Multivariate Event Collection
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/multivariate_event_collections/{collection_ticker} \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "selected_markets": [
    {
      "market_ticker": "<string>",
    }
  ],
}
'
```

200

500

```
{
  "event_ticker": "<string>",
      }
    ],
      }
    ],
  }
```

multivariate

Endpoint for creating an individual market in a multivariate event collection. This endpoint must be hit at least once before trading or looking up a market.

POST

/

multivariate_event_collections

/

{collection_ticker}

Create Market In Multivariate Event Collection

{
  "selected_markets": [
    {
      "market_ticker": "<string>",
    }
  ],
}
'
```

  "event_ticker": "<string>",
      }
    ],
      }
    ],
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

collection_ticker

string

required

Collection ticker

#### Body

application/json

selected_markets

object[]

required

List of selected markets that act as parameters to determine which market is created.

Show child attributes

with_market_payload

boolean

Whether to include the market payload in the response.

#### Response

application/json

Market created successfully

event_ticker

string

required

Event ticker for the created market.

market_ticker

string

required

Market ticker for the created market.

market

object

Market payload of the created market.

Show child attributes