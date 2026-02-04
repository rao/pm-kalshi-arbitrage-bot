Create Quote
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/quotes \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "rfq_id": "<string>",
}
'
```

201

500

```
{
  "id": "<string>"
}
```

communications

Endpoint for creating a quote in response to an RFQ

POST

/

communications

/

quotes

Create Quote

{
  "rfq_id": "<string>",
}
'
```

  "id": "<string>"
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

#### Body

application/json

rfq_id

string

required

The ID of the RFQ to quote on

yes_bid

string

required

The bid price for YES contracts, in dollars

Example:

`"0.5600"`

no_bid

string

required

The bid price for NO contracts, in dollars

Example:

`"0.5600"`

rest_remainder

boolean

required

Whether to rest the remainder of the quote after execution

subaccount

integer

Optional subaccount number to place the quote under (0 for primary, 1-32 for subaccounts)

#### Response

application/json

Quote created successfully

id

string

required

The ID of the newly created quote