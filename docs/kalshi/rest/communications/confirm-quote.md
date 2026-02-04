Confirm Quote
cURL

```
curl --request PUT \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/quotes/{quote_id}/confirm \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '{}'
```

401

500

```
{
  "code": "<string>",
}
```

communications

Endpoint for confirming a quote. This will start a timer for order execution

PUT

/

communications

/

quotes

/

{quote_id}

/

confirm

Confirm Quote

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

#### Body

application/json

An empty response body

#### Response

204

Quote confirmed successfully