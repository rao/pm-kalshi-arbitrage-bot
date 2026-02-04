Batch Create Orders
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/orders/batched \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "orders": [
    {
      "ticker": "<string>",
    }
  ]
}
'
```

201

500

```
{
  "orders": [
    {
      "client_order_id": "<string>",
      }
  ]
}
```

orders

Endpoint for submitting a batch of orders. Each order in the batch is counted against the total rate limit for order operations. Consequently, the size of the batch is capped by the current per-second rate-limit configuration applicable to the user. At the moment of writing, the limit is 20 orders per batch.

POST

/

portfolio

/

orders

/

batched

Batch Create Orders

{
  "orders": [
    {
      "ticker": "<string>",
    }
  ]
}
'
```

  "orders": [
    {
      "client_order_id": "<string>",
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

orders

object[]

required

Show child attributes

#### Response

application/json

Batch order creation completed

orders

object[]

required

Show child attributes