Get RFQ
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/rfqs/{rfq_id} \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "rfq": {
    "id": "<string>",
      }
    ],
  }
```

communications

Endpoint for getting a single RFQ by id

GET

/

communications

/

rfqs

/

{rfq_id}

Get RFQ

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

#### Path Parameters

rfq_id

string

required

RFQ ID

#### Response

application/json

RFQ retrieved successfully

rfq

object

required

The details of the requested RFQ

Show child attributes