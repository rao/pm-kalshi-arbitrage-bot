Get Order Queue Position
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/orders/{order_id}/queue_position \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "queue_position": 123,
}
```

orders

Endpoint for getting an order’s queue position in the order book. This represents the amount of orders that need to be matched before this order receives a partial or full match. Queue position is determined using a price-time priority.

GET

/

portfolio

/

orders

/

{order_id}

/

queue_position

Get Order Queue Position

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

order_id

string

required

Order ID

#### Response

application/json

Queue position retrieved successfully

queue_position

integer<int32>

required

The position of the order in the queue

queue_position_fp

string

The number of preceding shares before the order in the queue.

Example:

`"10.00"`