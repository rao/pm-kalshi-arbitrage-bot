Get Total Resting Order Value
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/summary/total_resting_order_value \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "total_resting_order_value": 123
}
```

portfolio

Endpoint for getting the total value, in cents, of resting orders. This endpoint is only intended for use by FCM members (rare). Note: If you’re uncertain about this endpoint, it likely does not apply to you.

GET

/

portfolio

/

summary

/

total_resting_order_value

Get Total Resting Order Value

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

#### Response

application/json

Total resting order value retrieved successfully

total_resting_order_value

integer

required

Total value of resting orders in cents