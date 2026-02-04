Get RFQs
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/rfqs \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "rfqs": [
    {
      "id": "<string>",
        }
      ],
    }
  ],
}
```

communications

Endpoint for getting RFQs

GET

/

communications

/

rfqs

Get RFQs

        }
      ],
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

cursor

string

Pagination cursor. Use the cursor value returned from the previous response to get the next page of results. Leave empty for the first page.

event_ticker

string

Event ticker of desired positions. Multiple event tickers can be provided as a comma-separated list (maximum 10).

market_ticker

string

Filter by market ticker

limit

integer<int32>

default:100

Parameter to specify the number of results per page. Defaults to 100.

Required range: `1 <= x <= 100`

status

string

Filter RFQs by status

creator_user_id

string

Filter RFQs by creator user ID

#### Response

application/json

RFQs retrieved successfully

rfqs

object[]

required

List of RFQs matching the query criteria

Show child attributes

cursor

string

Cursor for pagination to get the next page of results