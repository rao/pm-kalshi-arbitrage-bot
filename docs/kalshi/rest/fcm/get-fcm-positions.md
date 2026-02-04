Get FCM Positions
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/fcm/positions \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

```
{
  "market_positions": [
    {
      "ticker": "<string>",
    }
  ],
    }
  ],
}
```

fcm

Endpoint for FCM members to get market positions filtered by subtrader ID. This endpoint requires FCM member access level and allows filtering positions by subtrader ID.

GET

/

fcm

/

positions

Get FCM Positions

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

subtrader_id

string

required

Restricts the response to positions for a specific subtrader (FCM members only)

ticker

string

Ticker of desired positions

event_ticker

string

Event ticker of desired positions

count_filter

string

Restricts the positions to those with any of following fields with non-zero values, as a comma separated list

settlement_status

enum<string>

Settlement status of the markets to return. Defaults to unsettled

Available options:

`all`,

`unsettled`,

`settled`

limit

integer

Parameter to specify the number of results per page. Defaults to 100

Required range: `1 <= x <= 1000`

cursor

string

The Cursor represents a pointer to the next page of records in the pagination

#### Response

200

application/json

Positions retrieved successfully

market_positions

object[]

required

List of market positions

Show child attributes

event_positions

object[]

required

List of event positions

Show child attributes

cursor

string

The Cursor represents a pointer to the next page of records in the pagination. Use the value returned here in the cursor query parameter for this end-point to get the next page containing limit records. An empty value of this field indicates there is no next page.