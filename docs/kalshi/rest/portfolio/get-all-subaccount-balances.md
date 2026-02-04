Get All Subaccount Balances
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/subaccounts/balances \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "subaccount_balances": [
    {
      "subaccount_number": 123,
    }
  ]
}
```

portfolio

Gets balances for all subaccounts including the primary account.

GET

/

portfolio

/

subaccounts

/

balances

Get All Subaccount Balances

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

Balances retrieved successfully

subaccount_balances

object[]

required

Show child attributes