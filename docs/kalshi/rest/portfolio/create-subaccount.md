Create Subaccount
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/subaccounts \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

201

500

```
{
  "subaccount_number": 123
}
```

portfolio

Creates a new subaccount for the authenticated user. Subaccounts are numbered sequentially starting from 1. Maximum 32 subaccounts per user.

POST

/

portfolio

/

subaccounts

Create Subaccount

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

Subaccount created successfully

subaccount_number

integer

required

The sequential number assigned to this subaccount (1-32).