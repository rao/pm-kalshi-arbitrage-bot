Get Structured Targets
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/structured_targets
```

200

```
{
  "structured_targets": [
    {
      "id": "<string>",
    }
  ],
}
```

structured-targets

Page size (min: 1, max: 2000)

GET

/

structured_targets

Get Structured Targets

    }
  ],
}
```

#### Query Parameters

type

string

Filter by structured target type

competition

string

Filter by competition

page_size

integer<int32>

default:100

Number of items per page (min 1, max 2000, default 100)

Required range: `1 <= x <= 2000`

cursor

string

Pagination cursor

#### Response

200

application/json

Structured targets retrieved successfully

structured_targets

object[]

Show child attributes

cursor

string

Pagination cursor for the next page. Empty if there are no more results.