Get Milestones
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/milestones
```

200

```
{
  "milestones": [
    {
      "id": "<string>",
    }
  ],
}
```

milestone

Minimum start date to filter milestones. Format: RFC3339 timestamp

GET

/

milestones

Get Milestones

    }
  ],
}
```

#### Query Parameters

limit

integer

required

Number of milestones to return per page

Required range: `1 <= x <= 500`

minimum_start_date

string<date-time>

Minimum start date to filter milestones. Format RFC3339 timestamp

category

string

Filter by milestone category

competition

string

Filter by competition

source_id

string

Filter by source id

type

string

Filter by milestone type

related_event_ticker

string

Filter by related event ticker

cursor

string

Pagination cursor. Use the cursor value returned from the previous response to get the next page of results

#### Response

200

application/json

Milestones retrieved successfully

milestones

object[]

required

List of milestones.

Show child attributes

cursor

string

Cursor for pagination.