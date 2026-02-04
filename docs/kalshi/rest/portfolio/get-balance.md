Get Balance
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/balance \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "balance": 123,
}
```

portfolio

Endpoint for getting the balance and portfolio value of a member. Both values are returned in cents.

GET

/

portfolio

/

balance

Get Balance

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

Balance retrieved successfully

balance

integer<int64>

required

Member's available balance in cents. This represents the amount available for trading.

portfolio_value

integer<int64>

required

Member's portfolio value in cents. This is the current value of all positions held.

updated_ts

integer<int64>

required

Unix timestamp of the last update to the balance.