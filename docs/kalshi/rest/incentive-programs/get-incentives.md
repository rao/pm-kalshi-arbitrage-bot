Get Incentives
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/incentive_programs
```

200

500

```
{
  "incentive_programs": [
    {
      "id": "<string>",
    }
  ],
}
```

incentive-programs

List incentives with optional filters. Incentives are rewards programs for trading activity on specific markets.

GET

/

incentive_programs

Get Incentives

    }
  ],
}
```

#### Query Parameters

status

enum<string>

Status filter. Can be "all", "active", "upcoming", "closed", or "paid_out". Default is "all".

Available options:

`all`,

`active`,

`upcoming`,

`closed`,

`paid_out`

type

enum<string>

Type filter. Can be "all", "liquidity", or "volume". Default is "all".

Available options:

`all`,

`liquidity`,

`volume`

limit

integer

Number of results per page. Defaults to 100. Maximum value is 10000.

Required range: `1 <= x <= 10000`

cursor

string

Cursor for pagination

#### Response

application/json

Incentive programs retrieved successfully

incentive_programs

object[]

required

Show child attributes

next_cursor

string

Cursor for pagination to get the next page of results