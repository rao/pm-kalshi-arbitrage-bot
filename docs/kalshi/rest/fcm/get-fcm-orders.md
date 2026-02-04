Get FCM Orders
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/fcm/orders \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

```
{
  "orders": [
    {
      "order_id": "<string>",
    }
  ],
}
```

fcm

Endpoint for FCM members to get orders filtered by subtrader ID. This endpoint requires FCM member access level and allows filtering orders by subtrader ID.

GET

/

fcm

/

orders

Get FCM Orders

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

#### Query Parameters

subtrader_id

string

required

Restricts the response to orders for a specific subtrader (FCM members only)

cursor

string

Pagination cursor. Use the cursor value returned from the previous response to get the next page of results. Leave empty for the first page.

event_ticker

string

Event ticker of desired positions. Multiple event tickers can be provided as a comma-separated list (maximum 10).

ticker

string

Filter by market ticker

min_ts

integer<int64>

Restricts the response to orders after a timestamp, formatted as a Unix Timestamp

max_ts

integer<int64>

Restricts the response to orders before a timestamp, formatted as a Unix Timestamp

status

enum<string>

Restricts the response to orders that have a certain status

Available options:

`resting`,

`canceled`,

`executed`

limit

integer

Parameter to specify the number of results per page. Defaults to 100

Required range: `1 <= x <= 1000`

#### Response

200

application/json

Orders retrieved successfully

orders

object[]

required

Show child attributes

cursor

string

required