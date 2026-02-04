Batch Cancel Orders
cURL

```
curl --request DELETE \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/orders/batched \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "ids": [
    "<string>"
  ],
    }
  ]
}
'
```

200

500

```
{
  "orders": [
    {
      "order_id": "<string>",
      }
  ]
}
```

orders

Endpoint for cancelling up to 20 orders at once.

DELETE

/

portfolio

/

orders

/

batched

Batch Cancel Orders

{
  "ids": [
    "<string>"
  ],
    }
  ]
}
'
```

  "orders": [
    {
      "order_id": "<string>",
      }
  ]
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

#### Body

application/json

ids

string[]

deprecated

An array of order IDs to cancel

orders

object[]

An array of orders to cancel, each optionally specifying a subaccount

Show child attributes

#### Response

application/json

Batch order cancellation completed

orders

object[]

required

Show child attributes