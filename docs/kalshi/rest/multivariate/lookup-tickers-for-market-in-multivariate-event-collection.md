Lookup Tickers For Market In Multivariate Event Collection
cURL

```
curl --request PUT \
  --url https://api.elections.kalshi.com/trade-api/v2/multivariate_event_collections/{collection_ticker}/lookup \
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
  ]
}
'
```

200

500

```
{
  "event_ticker": "<string>",
}
```

multivariate

Endpoint for looking up an individual market in a multivariate event collection. If CreateMarketInMultivariateEventCollection has never been hit with that variable combination before, this will return a 404.

PUT

/

multivariate_event_collections

/

{collection_ticker}

/

lookup

Lookup Tickers For Market In Multivariate Event Collection

{
  "selected_markets": [
    {
      "market_ticker": "<string>",
    }
  ]
}
'
```

  "event_ticker": "<string>",
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

List of selected markets that act as parameters to determine which market is produced.

Show child attributes

#### Response

application/json

Market looked up successfully

event_ticker

string

required

Event ticker for the looked up market.

market_ticker

string

required

Market ticker for the looked up market.