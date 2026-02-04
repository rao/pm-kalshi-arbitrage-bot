Get Quotes
cURL

```
curl --request GET \
  --url 'https://api.elections.kalshi.com/trade-api/v2/communications/quotes?limit=500' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "quotes": [
    {
      "id": "<string>",
    }
  ],
}
```

communications

Endpoint for getting quotes

GET

/

communications

/

quotes

Get Quotes

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

default:500

Parameter to specify the number of results per page. Defaults to 500.

Required range: `1 <= x <= 500`

status

string

Filter quotes by status

quote_creator_user_id

string

Filter quotes by quote creator user ID

rfq_creator_user_id

string

Filter quotes by RFQ creator user ID

rfq_creator_subtrader_id

string

Filter quotes by RFQ creator subtrader ID (FCM members only)

rfq_id

string

Filter quotes by RFQ ID

#### Response

application/json

Quotes retrieved successfully

quotes

object[]

required

List of quotes matching the query criteria

Show child attributes

cursor

string

Cursor for pagination to get the next page of results