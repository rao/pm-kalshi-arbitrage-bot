Delete Quote
cURL

```
curl --request DELETE \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/quotes/{quote_id} \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

401

500

```
{
  "code": "<string>",
}
```

communications

Endpoint for deleting a quote, which means it can no longer be accepted.

DELETE

/

communications

/

quotes

/

{quote_id}

Delete Quote

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

204

Quote deleted successfully