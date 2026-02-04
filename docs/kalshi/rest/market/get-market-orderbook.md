Get Market Orderbook
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/markets/{ticker}/orderbook \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "orderbook": {
    "yes": [
      [
        123
      ]
    ],
  }
```

market

Endpoint for getting the current order book for a specific market. The order book shows all active bid orders for both yes and no sides of a binary market. It returns yes bids and no bids only (no asks are returned). This is because in binary markets, a bid for yes at price X is equivalent to an ask for no at price (100-X). For example, a yes bid at 7¢ is the same as a no ask at 93¢, with identical contract sizes. Each side shows price levels with their corresponding quantities and order counts, organized from best to worst prices.

GET

/

markets

/

{ticker}

/

orderbook

Get Market Orderbook

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

ticker

string

required

Market ticker

#### Query Parameters

depth

integer

default:0

Depth of the orderbook to retrieve (0 or negative means all levels, 1-100 for specific depth)

Required range: `0 <= x <= 100`

#### Response

application/json

Orderbook retrieved successfully

orderbook

object

required

Legacy integer-count orderbook (will be deprecated). Prefer orderbook_fp for fixed-point contract counts.

Show child attributes

orderbook_fp

object

required

Orderbook with fixed-point contract counts (fp) in all price levels.

Show child attributes