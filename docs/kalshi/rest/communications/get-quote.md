Get Quote
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/quotes/{quote_id} \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "quote": {
    "id": "<string>",
  }
```

communications

Endpoint for getting a particular quote

GET

/

communications

/

quotes

/

{quote_id}

Get Quote

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

quote_id

string

required

Quote ID

#### Response

application/json

Quote retrieved successfully

quote

object

required

The details of the requested quote

Show child attributes