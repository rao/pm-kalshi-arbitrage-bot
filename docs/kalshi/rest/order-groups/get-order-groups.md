Get Order Groups
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/order_groups \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "order_groups": [
    {
      "id": "<string>",
    }
  ]
}
```

order-groups

Retrieves all order groups for the authenticated user.

GET

/

portfolio

/

order_groups

Get Order Groups

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

#### Response

application/json

Order groups retrieved successfully

order_groups

object[]

Show child attributes