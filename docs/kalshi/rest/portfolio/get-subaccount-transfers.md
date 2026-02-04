Get Subaccount Transfers
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/subaccounts/transfers \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "transfers": [
    {
      "transfer_id": "<string>",
    }
  ],
}
```

portfolio

Gets a paginated list of all transfers between subaccounts for the authenticated user.

GET

/

portfolio

/

subaccounts

/

transfers

Get Subaccount Transfers

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

limit

integer<int64>

default:100

Number of results per page. Defaults to 100. Maximum value is 200.

Required range: `1 <= x <= 200`

cursor

string

Pagination cursor. Use the cursor value returned from the previous response to get the next page of results. Leave empty for the first page.

#### Response

application/json

Transfers retrieved successfully

transfers

object[]

required

Show child attributes

cursor

string

Cursor for the next page of results.