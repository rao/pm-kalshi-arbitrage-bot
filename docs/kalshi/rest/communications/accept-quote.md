Accept Quote
cURL

```
curl --request PUT \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/quotes/{quote_id}/accept \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "accepted_side": "yes"
}
'
```

400

500

```
{
  "code": "<string>",
}
```

communications

Endpoint for accepting a quote. This will require the quoter to confirm

PUT

/

communications

/

quotes

/

{quote_id}

/

accept

Accept Quote

{
  "accepted_side": "yes"
}
'
```

  "code": "<string>",
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

accepted_side

enum<string>

required

The side of the quote to accept (yes or no)

Available options:

`yes`,

`no`

#### Response

204

Quote accepted successfully