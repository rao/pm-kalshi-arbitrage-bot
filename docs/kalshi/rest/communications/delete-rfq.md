Delete RFQ
cURL

```
curl --request DELETE \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/rfqs/{rfq_id} \
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

Endpoint for deleting an RFQ by ID

DELETE

/

communications

/

rfqs

/

{rfq_id}

Delete RFQ

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

rfq_id

string

required

RFQ ID

#### Response

204

RFQ deleted successfully